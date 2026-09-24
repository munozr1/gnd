/**
 * Model assignment: physical footprint per component, optics per port, bulk
 * assignment by ref glob, and the compatibility / default-cable rules the
 * assignment table and wire tool rely on.
 */
import { catalogIndex } from '@/catalog';
import { formFactorFits } from '../query';
import type {
  Catalog,
  FootprintDef,
  Id,
  Link,
  LinkEnd,
  PortType,
  Project,
  SymbolDef,
  TransceiverDef,
} from '../types';
import { findComponent, requireComponent } from './lookup';

export function assignFootprint(draft: Project, componentIds: readonly Id[], footprintDefId: string | null): number {
  let n = 0;
  for (const id of componentIds) {
    const c = findComponent(draft, id);
    if (!c || c.footprintDefId === footprintDefId) continue;
    c.footprintDefId = footprintDefId;
    n++;
  }
  return n;
}

export function assignOptic(draft: Project, componentId: Id, portId: string, opticId: string | null): void {
  const c = requireComponent(draft, componentId);
  if (opticId === null) delete c.optics[portId];
  else c.optics[portId] = opticId;
}

/** Glob with '*' (any run) and '?' (one char), anchored, case-insensitive. */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

export const globMatch = (glob: string, s: string): boolean => globToRegExp(glob).test(s);

export interface BulkAssignOptions {
  /** Ref pattern, e.g. 'SRV*' or 'SW1?'. */
  refGlob: string;
  footprintDefId?: string | null;
  /** Each entry assigns `opticId` to every matching port whose cage accepts it. */
  optics?: { portGlob: string; opticId: string }[];
}

/**
 * Apply a footprint and/or optics to every component whose ref matches.
 * Optics that do not fit a port's form factor are skipped. Returns the number
 * of matched components.
 */
export function bulkAssign(draft: Project, opts: BulkAssignOptions): number {
  const refRe = globToRegExp(opts.refGlob);
  const catalog = catalogIndex(draft);
  const opticRules = (opts.optics ?? []).map((o) => ({
    re: globToRegExp(o.portGlob),
    opticId: o.opticId,
    def: catalog.transceiver(o.opticId),
  }));
  let matched = 0;
  for (const c of draft.components) {
    if (!refRe.test(c.ref)) continue;
    matched++;
    if (opts.footprintDefId !== undefined) c.footprintDefId = opts.footprintDefId;
    if (opticRules.length === 0) continue;
    const symbol = catalog.symbol(c.symbolDefId);
    if (!symbol) continue;
    for (const pin of symbol.pins) {
      for (const rule of opticRules) {
        if (!rule.re.test(pin.portId)) continue;
        if (rule.def && !formFactorFits(pin.type, rule.def.formFactor)) continue;
        c.optics[pin.portId] = rule.opticId;
      }
    }
  }
  return matched;
}

/**
 * Footprints a symbol can take: its declared defaults first, then any footprint
 * whose ports cover every symbol pin (same id, compatible cage type).
 */
export function compatibleFootprints(catalog: Catalog, symbol: SymbolDef): FootprintDef[] {
  const byId = new Map(catalog.footprints.map((f) => [f.id, f] as const));
  const out: FootprintDef[] = [];
  const seen = new Set<string>();
  for (const id of symbol.defaultFootprintIds) {
    const f = byId.get(id);
    if (f && !seen.has(f.id)) {
      seen.add(f.id);
      out.push(f);
    }
  }
  for (const f of catalog.footprints) {
    if (seen.has(f.id)) continue;
    const ports = new Map(f.ports.map((p) => [p.id, p] as const));
    const covers = symbol.pins.every((pin) => {
      const port = ports.get(pin.portId);
      return port !== undefined && formFactorFits(port.type, pin.type);
    });
    if (covers) {
      seen.add(f.id);
      out.push(f);
    }
  }
  return out;
}

/** Transceivers that fit a cage of the given type (exact or backward-compatible). */
export function compatibleOptics(catalog: Catalog, portType: PortType): TransceiverDef[] {
  return catalog.transceivers.filter((t) => formFactorFits(portType, t.formFactor));
}

type OpticRef = TransceiverDef | string | null | undefined;

const resolveOptic = (catalog: Catalog, o: OpticRef): TransceiverDef | undefined =>
  typeof o === 'string' ? catalog.transceivers.find((t) => t.id === o) : (o ?? undefined);

/** Cable ends as connector families ('LC', 'MPO', 'RJ45'). */
const connectorFamily = (connector: string): 'LC' | 'MPO' | 'RJ45' | null => {
  const c = connector.toUpperCase();
  if (c === 'LC') return 'LC';
  if (c.startsWith('MPO')) return 'MPO';
  if (c === 'RJ45') return 'RJ45';
  return null;
};

/**
 * Cable a pair of connector families and fibre media call for:
 * MMF+LC -> om4-duplex, SMF+LC -> os2-duplex, MMF+MPO -> om4-mpo-trunk,
 * SMF+MPO -> os2-mpo-trunk, RJ45 -> cat6a; anything else null.
 */
export function defaultCableForConnectors(
  catalog: Catalog,
  a: { connector: string; media?: string },
  b: { connector: string; media?: string },
): string | null {
  const fa = connectorFamily(a.connector);
  const fb = connectorFamily(b.connector);
  if (!fa || !fb || fa !== fb) return null;
  const has = (id: string): string | null => (catalog.cables.some((c) => c.id === id) ? id : null);
  if (fa === 'RJ45') return has('cbl.cat6a');
  const medias = new Set([a.media, b.media].filter((m): m is string => m !== undefined));
  if (medias.size !== 1) return null;
  const media = [...medias][0];
  if (media === 'MMF') return has(fa === 'LC' ? 'cbl.om4-duplex' : 'cbl.om4-mpo-trunk');
  if (media === 'SMF') return has(fa === 'LC' ? 'cbl.os2-duplex' : 'cbl.os2-mpo-trunk');
  return null;
}

/** Default cable for a link between two optics (ids or defs). Null when either is missing or they disagree. */
export function defaultCableFor(catalog: Catalog, opticA: OpticRef, opticB: OpticRef): string | null {
  const a = resolveOptic(catalog, opticA);
  const b = resolveOptic(catalog, opticB);
  if (!a || !b) return null;
  return defaultCableForConnectors(catalog, a, b);
}

/**
 * What a link end presents to a cable: the assigned optic's connector and
 * media, or the fixed connector of an LC / MPO / RJ45 port (which has no media).
 */
export function endConnector(project: Project, end: LinkEnd): { connector: string; media?: string } | null {
  const catalog = catalogIndex(project);
  const c = findComponent(project, end.componentId);
  if (!c) return null;
  const optic = catalog.transceiver(c.optics[end.portId]);
  if (optic) return { connector: optic.connector, media: optic.media };
  const pin = catalog.symbol(c.symbolDefId)?.pins.find((p) => p.portId === end.portId);
  if (!pin) return null;
  if (pin.type === 'LC' || pin.type === 'MPO-12' || pin.type === 'RJ45') return { connector: pin.type };
  return null;
}

/** Default cable for a link given the optics / fixed connectors at its ends. */
export function defaultCableForLink(project: Project, link: Pick<Link, 'a' | 'b'>): string | null {
  const a = endConnector(project, link.a);
  const b = endConnector(project, link.b);
  if (!a || !b) return null;
  return defaultCableForConnectors(catalogIndex(project).catalog, a, b);
}

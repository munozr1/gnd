import { buildCustomDevice } from '@/commands/customDevice';
import { createComponent, createLink, createProject, createRack, createSheet } from '@/model/factories';
import { applySyncPlan, computeSyncPlan } from '@/model/sync';
import type { Component, PortType, Project } from '@/model/types';

export interface CsvTable { headers: string[]; rows: string[][] }
export interface CutsheetMapping { a: number; b: number; speed: number; state: number; linkType: number }
export interface CutsheetEndpoint { device: string; port: string }
export interface CutsheetLink { row: number; a: CutsheetEndpoint; b: CutsheetEndpoint; speed: number; state: string; linkType: string }
export interface ImportIssue { row: number; message: string }
export interface CutsheetPlan {
  links: CutsheetLink[];
  devices: string[];
  errors: ImportIssue[];
  warnings: ImportIssue[];
  sourceRows: number;
}

/** RFC-style comma-separated records, including quoted commas, quotes and line breaks. */
export function readCutsheetCsv(text: string): CsvTable {
  if (text.length > 5_000_000) throw new Error('CSV is too large. Use a file smaller than 5 MB.');
  const records: string[][] = [];
  let row: string[] = [], field = '', quoted = false, closed = false;
  const fieldEnd = () => { row.push(field); field = ''; closed = false; };
  const rowEnd = () => { fieldEnd(); records.push(row); row = []; };
  const source = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i++) {
    const c = source[i]!;
    if (quoted) {
      if (c === '"') { if (source[i + 1] === '"') { field += '"'; i++; } else { quoted = false; closed = true; } }
      else field += c;
    } else if (c === ',') fieldEnd();
    else if (c === '\n' || c === '\r') { rowEnd(); if (c === '\r' && source[i + 1] === '\n') i++; }
    else if (c === '"' && !field && !closed) quoted = true;
    else if (closed && /[ \t]/.test(c)) continue;
    else if (c === '"' || closed) throw new Error(`Invalid CSV quoting near record ${records.length + 1}.`);
    else field += c;
    if (records.length > 10_001) throw new Error('CSV contains more than 10,000 connection rows. Split it into smaller files.');
  }
  if (quoted) throw new Error('CSV has an unclosed quoted field.');
  if (field || row.length || closed) rowEnd();
  if (records.length > 10_001) throw new Error('CSV contains more than 10,000 connection rows. Split it into smaller files.');
  if (!records.length) throw new Error('CSV is empty.');
  const headers = records.shift()!.map((s) => s.trim());
  if (headers.length < 3) throw new Error('Expected a comma-separated CSV with a header and endpoint/speed columns.');
  return { headers, rows: records };
}

export function detectCutsheetMapping(table: CsvTable): CutsheetMapping {
  const headers = table.headers.map((s) => s.toLowerCase().replace(/[\s-]+/g, '_'));
  const find = (names: string[], fallback: number) => { const i = headers.findIndex((h) => names.includes(h)); return i < 0 ? fallback : i; };
  return { a: find(['a_end_interface'], 3), b: find(['b_end_interface'], 4), speed: find(['capacity', 'speed', 'speed_gbps'], 5), state: find(['state', 'status'], -1), linkType: find(['link_type'], -1) };
}

/** Split at the final underscore so underscores inside hostnames remain intact. */
export function parseEndpoint(value: string): CutsheetEndpoint | null {
  const text = value.trim(), at = text.lastIndexOf('_');
  const device = text.slice(0, at).trim(), port = text.slice(at + 1).trim();
  return at > 0 && device && port && !/[\r\n\x00-\x1f]/.test(device + port) ? { device, port } : null;
}
export function parseCapacity(value: string): number | null {
  const match = /^(\d+(?:\.\d+)?)\s*(g(?:bps|bit\/?s)?|m(?:bps|bit\/?s)?|t(?:bps|bit\/?s)?)?$/i.exec(value.trim());
  if (!match) return null;
  const amount = Number(match[1]), unit = match[2]?.charAt(0).toLowerCase();
  const speed = amount * (unit === 'm' ? 0.001 : unit === 't' ? 1000 : 1);
  return speed > 0 && speed <= 800 ? speed : null;
}
const endpointKey = (e: CutsheetEndpoint) => JSON.stringify([e.device, e.port]);

export function planCutsheet(table: CsvTable, mapping = detectCutsheetMapping(table)): CutsheetPlan {
  const plan: CutsheetPlan = { links: [], devices: [], errors: [], warnings: [], sourceRows: 0 };
  const required = [mapping.a, mapping.b, mapping.speed];
  if (required.some((i) => !Number.isInteger(i) || i < 0 || i >= table.headers.length) || new Set(required).size !== 3) {
    plan.errors.push({ row: 1, message: 'Choose three different columns for endpoint A, endpoint B and speed.' }); return plan;
  }
  const endpoints = new Map<string, number>(), pairs = new Map<string, CutsheetLink>(), devices = new Set<string>();
  table.rows.forEach((cells, i) => {
    if (cells.every((s) => !s.trim())) return;
    const row = i + 2, fail = (message: string) => plan.errors.push({ row, message });
    plan.sourceRows++;
    if (cells.length !== table.headers.length) { fail(`Expected ${table.headers.length} columns; found ${cells.length}.`); return; }
    const a = parseEndpoint(cells[mapping.a] ?? ''), b = parseEndpoint(cells[mapping.b] ?? ''), speed = parseCapacity(cells[mapping.speed] ?? '');
    if (!a || !b) { fail(`Endpoint ${!a ? 'A' : 'B'} must use device_port format (for example switch01_xe-0/0/1).`); return; }
    if (speed === null) { fail('Speed must be a positive Gbps value up to 800 (for example 10, 100G or 10000 Mbps).'); return; }
    const ka = endpointKey(a), kb = endpointKey(b), pair = JSON.stringify([ka, kb].sort());
    if (ka === kb) { fail('Both endpoints refer to the same device port.'); return; }
    const state = cells[mapping.state]?.trim() ?? '', linkType = cells[mapping.linkType]?.trim() ?? '';
    const existing = pairs.get(pair);
    if (existing && existing.speed === speed && existing.state === state && existing.linkType === linkType) {
      plan.warnings.push({ row, message: `Duplicate of row ${existing.row}; imported once.` }); return;
    }
    if (endpoints.has(ka) || endpoints.has(kb)) { fail(`Port already assigned in row ${endpoints.get(ka) ?? endpoints.get(kb)}. Resolve the conflicting connection or speed.`); return; }
    const link = { row, a, b, speed, state, linkType };
    plan.links.push(link); pairs.set(pair, link); endpoints.set(ka, row); endpoints.set(kb, row); devices.add(a.device); devices.add(b.device);
  });
  plan.devices = [...devices].sort(natural);
  if (!plan.sourceRows) plan.errors.push({ row: 2, message: 'No connection rows were found.' });
  return plan;
}
const natural = (a: string, b: string) => a.localeCompare(b, 'en', { numeric: true });
const portType = (speed: number): PortType => speed <= 1 ? 'SFP' : speed <= 10 ? 'SFP+' : speed <= 25 ? 'SFP28' : speed <= 40 ? 'QSFP+' : speed <= 100 ? 'QSFP28' : speed <= 200 ? 'QSFP56' : speed <= 400 ? 'QSFP-DD' : 'OSFP';

/** Put the most-connected devices in the overview and paginate the rest into readable sheets. */
export function cutsheetGroups(plan: CutsheetPlan): string[][] {
  const degree = new Map<string, number>();
  for (const link of plan.links) for (const e of [link.a, link.b]) degree.set(e.device, (degree.get(e.device) ?? 0) + 1);
  const sorted = [...plan.devices].sort((a, b) => (degree.get(b)! - degree.get(a)!) || natural(a, b));
  if (sorted.length <= 12) return [sorted];
  const core = sorted.filter((d) => degree.get(d)! > 1).slice(0, 8);
  if (!core.length) core.push(sorted[0]!);
  const rest = sorted.filter((d) => !core.includes(d)).sort(natural), groups = [core];
  for (let i = 0; i < rest.length; i += 12) groups.push(rest.slice(i, i + 12));
  return groups;
}

/** A new document, built off-store; existing projects are never modified by the import. */
export function buildCutsheetProject(plan: CutsheetPlan, options: { name: string; draftRacks: boolean }): Project {
  if (plan.errors.length || !plan.links.length) throw new Error('Resolve the CSV errors before importing.');
  const project = createProject(options.name.trim() || 'Imported cutsheet'), components = new Map<string, Component>();
  const groups = cutsheetGroups(plan);
  groups.forEach((names, group) => {
    const sheet = group === 0 ? project.sheets[0]! : createSheet(`Devices ${group}`, 'root', { x: 260 + Math.min(3, groups[0]!.length) * 520 + ((group - 1) % 2) * 380, y: 100 + Math.floor((group - 1) / 2) * 240 });
    if (group) { sheet.sch!.width = 280; sheet.sch!.height = 160; project.sheets.push(sheet); }
    let rack: ReturnType<typeof createRack> | undefined;
    if (options.draftRacks) {
      rack = createRack({ id: 'draft', name: 'Draft 42U rack', heightU: 42, widthMm: 600, depthMm: 1070 }, { name: `Draft ${String(group + 1).padStart(2, '0')}`, pos: { x: 1200 + group % 6 * 1400, y: 1800 + Math.floor(group / 6) * 2600 }, row: `Draft ${Math.floor(group / 6) + 1}` });
      project.racks.push(rack);
    }
    let y = 100;
    for (let row = 0; row < names.length; row += 3) {
      let rowHeight = 100;
      names.slice(row, row + 3).forEach((name, column) => {
        const ports = plan.links.flatMap((link) => [link.a, link.b].filter((e) => e.device === name).map((e) => ({ id: e.port, speedsGbps: [link.speed], type: portType(link.speed) }))).sort((a, b) => natural(a.id, b.id));
        const def = buildCustomDevice({ name: `${name} (draft 1U)`, kind: 'generic', heightU: 1, depthMm: 500, ports, category: 'Cutsheet imports' }, project);
        def.symbol.width = Math.max(280, name.length * 8);
        project.customCatalog.symbols.push(def.symbol); project.customCatalog.footprints.push(def.footprint);
        const c = createComponent(def.symbol, { sheetId: sheet.id, pos: { x: 100 + column * 520, y }, ref: name, value: 'Imported' });
        project.components.push(c); components.set(name, c); rowHeight = Math.max(rowHeight, def.symbol.height);
        if (rack) project.placements.push({ componentId: c.id, rackId: rack.id, uPosition: 1 + (row + column) * 3, face: 'front' });
      });
      y += rowHeight + 120;
    }
  });
  for (const link of plan.links) {
    const label = [`${link.speed}G`, link.state, link.linkType].filter(Boolean).join(' · ');
    project.links.push(createLink({ componentId: components.get(link.a.device)!.id, portId: link.a.port }, { componentId: components.get(link.b.device)!.id, portId: link.b.port }, null, label));
  }
  const width = Math.max(12000, Math.min(groups.length, 6) * 1400 + 2400), depth = Math.max(8000, Math.ceil(groups.length / 6) * 2600 + 2400);
  project.room.outline = [{ x: 0, y: 0 }, { x: width, y: 0 }, { x: width, y: depth }, { x: 0, y: depth }];
  applySyncPlan(project, computeSyncPlan(project).changes);
  return project;
}

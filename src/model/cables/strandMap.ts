/**
 * Derives which (leg, position) each fiber of a cable lands on at both ends,
 * and checks a (possibly user-customised) map is a bijection. Pure; no React /
 * Konva / Three.
 *
 * The rule, in full:
 *
 * 1. Fibers are numbered 1..N along the cable in SIDE A order: walk A's legs
 *    in order, each leg's positions in order. `map[n - 1].a` is always A's nth
 *    slot, whatever the polarity does to the other end.
 *
 * 2. Base map (before polarity), by connector family of the two sides:
 *    - multi ↔ multi and small ↔ small (LC / SN / CS): SEQUENTIAL — B is
 *      walked the same way, so fiber n meets B's nth slot. A 24F MPO-24 →
 *      2×MPO-12 sends positions 1-12 to leg A and 13-24 to leg B, each in
 *      order; a 144F 12×MPO-12 trunk is leg n ↔ leg n, p ↔ p.
 *    - multi ↔ small (a breakout into duplex or simplex legs): CHANNEL
 *      pairing. Channels on the multi side are OUTER-IN within each leg: for a
 *      leg with M used positions sorted ascending p[0..M-1], channel k pairs
 *      p[k-1] (Tx) with p[M-k] (Rx), so an 8F MPO-8 is (1,12) (2,11) (3,10)
 *      (4,9) and an MPO-12 is (1,12) … (6,7); channel numbers continue across
 *      multi legs. On the small side channel c is its sequential slots 2c-1
 *      (Tx) and 2c (Rx): duplex leg c positions 1 and 2, or simplex legs 2c-1
 *      and 2c. Channel c of one side meets channel c of the other, Tx to Tx.
 *
 * 3. Polarity is a permutation of positions applied on ONE side, the polarity
 *    side: the multi-fiber side of a multi ↔ small breakout (the trunk
 *    connector carries the polarity; the duplex legs' 1/2 order is fixed by
 *    the channel pairing), otherwise side B (permuting both ends would cancel
 *    out). Per leg on that side:
 *    - multi-fiber leg: 'A' identity; 'B' p ↦ N+1-p over the connector BODY
 *      size N (MPO-8: 1↔12, 2↔11, 3↔10, 4↔9); 'C' pairs flipped, 2n-1 ↔ 2n.
 *    - small leg (only reached on a small ↔ small cord): the A-to-B crossover,
 *      i.e. the two slots of every channel swapped (duplex 1 ↔ 2; simplex legs
 *      2c-1 ↔ 2c), for EVERY polarity letter. A duplex patch cord is always
 *      A-to-B; on a two-position body the 'B' reversal and the 'C' pair flip
 *      are that same swap, and 'A' is read as the A-to-B cord too because an
 *      A-to-A cord is not a thing anyone stocks. So 2F LC-duplex ↔ LC-duplex
 *      is (1↔2), (2↔1) whatever the polarity.
 *
 *    Consequence worth knowing: on an MPO-8 → 4×LC breakout, polarity 'B'
 *    reverses the MPO positions and, because channels are outer-in, that is
 *    exactly a Tx/Rx swap on every LC leg: A pos 1 → leg 1 pos 2, A pos 12 →
 *    leg 1 pos 1.
 */
import type { CablePolarity, StrandLink } from '@/model/types';
import { requireConnector, type ConnectorFamily } from './connectors';
import type { ResolvedSide } from './deriveSides';

type Slot = StrandLink['a'];

const slotKey = (s: Slot): string => `${s.leg}:${s.pos}`;

/** Every (leg, position) of a side in leg order, positions in order. */
function sequentialSlots(side: ResolvedSide): Slot[] {
  const out: Slot[] = [];
  for (const leg of side.legs) for (const pos of leg.positions) out.push({ leg: leg.index, pos });
  return out;
}

/** Outer-in channel order within each multi-fiber leg: p[0], p[M-1], p[1], p[M-2], … */
function outerInSlots(side: ResolvedSide): Slot[] {
  const out: Slot[] = [];
  for (const leg of side.legs) {
    const p = [...leg.positions].sort((x, y) => x - y);
    let lo = 0;
    let hi = p.length - 1;
    while (lo <= hi) {
      out.push({ leg: leg.index, pos: p[lo]! });
      if (hi !== lo) out.push({ leg: leg.index, pos: p[hi]! });
      lo++;
      hi--;
    }
  }
  return out;
}

const familyOf = (side: ResolvedSide): ConnectorFamily => requireConnector(side.connector).family;

/** Position permutation for a multi-fiber leg under a polarity letter, over the connector body size. */
function multiPermutation(polarity: CablePolarity, bodyPositions: number): (pos: number) => number {
  switch (polarity) {
    case 'A':
      return (pos) => pos;
    case 'B':
      return (pos) => bodyPositions + 1 - pos;
    case 'C':
      return (pos) => (pos % 2 === 1 ? pos + 1 : pos - 1);
  }
}

/** The A-to-B crossover of a small-connector side: the two slots of each channel swapped. */
function crossoverPermutation(side: ResolvedSide): (slot: Slot) => Slot {
  const seq = sequentialSlots(side);
  const swap = new Map<string, Slot>();
  for (let i = 0; i + 1 < seq.length; i += 2) {
    swap.set(slotKey(seq[i]!), seq[i + 1]!);
    swap.set(slotKey(seq[i + 1]!), seq[i]!);
  }
  return (slot) => swap.get(slotKey(slot)) ?? slot;
}

/**
 * The strand map of a cable from its resolved sides and polarity (see the
 * module doc for the rule). Throws when a side does not carry `fiberCount`
 * fibers, which `deriveSides` guarantees never happens for its own output.
 */
export function deriveStrandMap(
  fiberCount: number,
  sideA: ResolvedSide,
  sideB: ResolvedSide,
  polarity: CablePolarity,
): StrandLink[] {
  const seqA = sequentialSlots(sideA);
  const seqB = sequentialSlots(sideB);
  if (seqA.length !== fiberCount || seqB.length !== fiberCount) {
    throw new Error(
      `Strand map for ${fiberCount} fibers needs ${fiberCount} positions per side, got ${seqA.length} on A and ${seqB.length} on B.`,
    );
  }
  const famA = familyOf(sideA);
  const famB = familyOf(sideB);

  // Base map: channel pairing when exactly one side is multi-fiber, else sequential.
  const breakout = famA !== famB;
  const orderA = breakout && famA === 'multi' ? outerInSlots(sideA) : seqA;
  const orderB = breakout && famB === 'multi' ? outerInSlots(sideB) : seqB;
  let links: StrandLink[] = orderA.map((a, i) => ({ a: { ...a }, b: { ...orderB[i]! } }));

  // Polarity on one side: the multi side of a breakout, else side B.
  const polaritySide: 'a' | 'b' = breakout && famA === 'multi' ? 'a' : 'b';
  const side = polaritySide === 'a' ? sideA : sideB;
  const family = polaritySide === 'a' ? famA : famB;
  const permute: (slot: Slot) => Slot =
    family === 'multi'
      ? ((): ((slot: Slot) => Slot) => {
          const sigma = multiPermutation(polarity, requireConnector(side.connector).positions);
          return (slot) => ({ leg: slot.leg, pos: sigma(slot.pos) });
        })()
      : crossoverPermutation(side);
  links = links.map((l) => (polaritySide === 'a' ? { a: permute(l.a), b: l.b } : { a: l.a, b: permute(l.b) }));

  // Fiber n is A's nth sequential slot.
  const order = new Map(seqA.map((s, i) => [slotKey(s), i] as const));
  return links.sort((x, y) => (order.get(slotKey(x.a)) ?? 0) - (order.get(slotKey(y.a)) ?? 0));
}

/**
 * Whether `map` wires every used (leg, position) of each side exactly once.
 * `problems` names each offending slot by side, leg label and position, so a
 * custom map's mistakes can be listed to the user.
 */
export function isBijection(
  map: readonly StrandLink[],
  sideA: ResolvedSide,
  sideB: ResolvedSide,
): { ok: boolean; problems: string[] } {
  const problems: string[] = [];
  const check = (name: 'A' | 'B', side: ResolvedSide, pick: (l: StrandLink) => Slot): void => {
    const counts = new Map<string, number>();
    for (const slot of sequentialSlots(side)) counts.set(slotKey(slot), 0);
    for (const link of map) {
      const slot = pick(link);
      const leg = side.legs[slot.leg];
      if (!leg) {
        problems.push(`Side ${name} has no leg ${slot.leg + 1} (wired to position ${slot.pos})`);
        continue;
      }
      if (!leg.positions.includes(slot.pos)) {
        problems.push(`Side ${name} leg ${leg.label} has no position ${slot.pos}`);
        continue;
      }
      counts.set(slotKey(slot), (counts.get(slotKey(slot)) ?? 0) + 1);
    }
    for (const leg of side.legs) {
      for (const pos of leg.positions) {
        const n = counts.get(slotKey({ leg: leg.index, pos })) ?? 0;
        if (n === 0) problems.push(`Side ${name} leg ${leg.label} position ${pos} is not wired`);
        else if (n > 1) problems.push(`Side ${name} leg ${leg.label} position ${pos} is wired ${n} times`);
      }
    }
  };
  check('A', sideA, (l) => l.a);
  check('B', sideB, (l) => l.b);
  return { ok: problems.length === 0, problems };
}

/** Fibers a strand map wires end to end (one link per fiber). */
export function strandMapFiberCount(map: readonly StrandLink[]): number {
  return map.length;
}

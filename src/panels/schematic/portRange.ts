/**
 * Port range specs for the fabric dialog: 'eth1/49-eth1/56', the shorthand
 * 'eth1/49-56', comma / space separated lists, or any mix of the three.
 * Pure; the dialog shows the parse error inline.
 */

const TAIL_RE = /^(.*?)(\d+)$/;
/** Guards against 'eth1/1-99999' blowing up the dialog. */
export const MAX_PORT_RANGE = 4096;

const pad = (n: number, width: number): string => String(n).padStart(width, '0');

/**
 * Expand a range spec into port ids, in the order written. `known` lets a
 * literal port id that happens to contain '-' pass through untouched.
 * Throws with a readable message on malformed input.
 */
export function parsePortRange(spec: string, known?: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const tokens = spec
    .split(/[,\s]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  for (const token of tokens) {
    if (known?.has(token)) {
      out.push(token);
      continue;
    }
    const dash = token.lastIndexOf('-');
    if (dash < 0) {
      out.push(token);
      continue;
    }
    const left = token.slice(0, dash);
    const right = token.slice(dash + 1);
    if (!left || !right) throw new Error(`Cannot read port range '${token}'`);
    const lm = TAIL_RE.exec(left);
    if (!lm) throw new Error(`'${left}' does not end in a port number`);
    const prefix = lm[1]!;
    const width = lm[2]!.length;
    const start = Number(lm[2]);
    let end: number;
    if (/^\d+$/.test(right)) {
      end = Number(right);
    } else {
      const rm = TAIL_RE.exec(right);
      if (!rm) throw new Error(`'${right}' does not end in a port number`);
      if (rm[1] !== prefix) throw new Error(`'${left}' and '${right}' are on different port prefixes`);
      end = Number(rm[2]);
    }
    if (Math.abs(end - start) + 1 > MAX_PORT_RANGE) throw new Error(`Range '${token}' is longer than ${MAX_PORT_RANGE} ports`);
    const step = end >= start ? 1 : -1;
    for (let n = start; ; n += step) {
      out.push(`${prefix}${pad(n, width)}`);
      if (n === end) break;
    }
  }
  return out;
}

/** Inverse of `parsePortRange`: consecutive ids collapse to 'first-last'; runs are joined with ', '. */
export function formatPortRange(ids: readonly string[]): string {
  const runs: string[] = [];
  let i = 0;
  while (i < ids.length) {
    const first = ids[i]!;
    const m = TAIL_RE.exec(first);
    let j = i;
    if (m) {
      const prefix = m[1]!;
      const width = m[2]!.length;
      let n = Number(m[2]);
      while (j + 1 < ids.length) {
        const nm = TAIL_RE.exec(ids[j + 1]!);
        if (!nm || nm[1] !== prefix || Number(nm[2]) !== n + 1 || nm[2]!.length !== width) break;
        n++;
        j++;
      }
    }
    runs.push(j === i ? first : `${first}-${ids[j]!}`);
    i = j + 1;
  }
  return runs.join(', ');
}

/** Parse without throwing: `{ ids }` or `{ error }`. */
export function tryParsePortRange(spec: string, known?: ReadonlySet<string>): { ids: string[]; error: null } | { ids: null; error: string } {
  try {
    return { ids: parsePortRange(spec, known), error: null };
  } catch (err) {
    return { ids: null, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Minimal RFC 4180 CSV writer: a cell is quoted when it contains a comma, a
 * quote, a line break or leading / trailing whitespace; quotes are doubled.
 * Lines end with '\n' (Excel, Numbers and label-printer tools all accept it).
 */
export type CsvCell = string | number | boolean | null | undefined;

export function csvEscape(v: CsvCell): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'string' ? v : String(v);
  if (s === '') return '';
  const needsQuotes = /[",\r\n]/.test(s) || s !== s.trim();
  return needsQuotes ? `"${s.replace(/"/g, '""')}"` : s;
}

export function csvLine(cells: readonly CsvCell[]): string {
  return cells.map(csvEscape).join(',');
}

/** Rows to a CSV document with a trailing newline. */
export function toCsv(rows: readonly (readonly CsvCell[])[]): string {
  return rows.map(csvLine).join('\n') + '\n';
}

/**
 * Parse one CSV document back into rows (tests and round-trips). Handles
 * quoted cells with embedded commas, quotes and newlines; ignores a trailing
 * empty line.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') {
      quoted = true;
    } else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

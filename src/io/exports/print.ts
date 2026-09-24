/**
 * The "PDF" path. Browsers cannot write PDFs from JavaScript without a
 * heavyweight library, but every browser's print dialog can save to PDF. So
 * the multi-page exports (rack elevation sheets, schematic plots) build a
 * printable HTML document with one SVG per page, open it in a new tab and
 * call `window.print()`; the user picks "Save as PDF" as the destination.
 */
import { esc } from './svg';

export interface PrintPage {
  /** A complete SVG document or fragment for this page. */
  svg: string;
  orientation: 'portrait' | 'landscape';
}

export interface PrintableOptions {
  title: string;
  pages: readonly PrintPage[];
  /** Call window.print() once the document has loaded (default true). */
  autoPrint?: boolean;
}

/** Strip the XML prologue so the SVG can be inlined in HTML. */
export const inlineSvg = (svg: string): string => svg.replace(/^<\?xml[^>]*\?>\s*/, '');

export function printableHtml(o: PrintableOptions): string {
  const pages = o.pages
    .map(
      (p, i) =>
        `<section class="page ${p.orientation}" data-page="${i + 1}" aria-label="Page ${i + 1}">${inlineSvg(p.svg)}</section>`,
    )
    .join('\n');
  const autoPrint = o.autoPrint ?? true;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(o.title)}</title>
<style>
  @page portrait { size: A4 portrait; margin: 8mm; }
  @page landscape { size: A4 landscape; margin: 8mm; }
  html, body { margin: 0; padding: 0; background: #666; font-family: Helvetica, Arial, sans-serif; }
  .toolbar { position: sticky; top: 0; z-index: 1; display: flex; gap: 12px; align-items: center; padding: 8px 12px; background: #222; color: #eee; font-size: 13px; }
  .toolbar button { font: inherit; padding: 4px 10px; }
  .page { background: #fff; margin: 12px auto; box-shadow: 0 2px 8px rgba(0,0,0,.4); overflow: hidden; }
  .page.portrait { width: 595pt; height: 842pt; page: portrait; }
  .page.landscape { width: 842pt; height: 595pt; page: landscape; }
  .page svg { display: block; width: 100%; height: 100%; }
  @media print {
    html, body { background: #fff; }
    .toolbar { display: none; }
    .page { margin: 0; box-shadow: none; page-break-after: always; break-after: page; width: auto; height: auto; }
    .page:last-child { page-break-after: auto; break-after: auto; }
  }
</style>
</head>
<body>
<div class="toolbar">
  <button type="button" onclick="window.print()">Print / Save as PDF</button>
  <span>${esc(o.title)} — ${o.pages.length} page${o.pages.length === 1 ? '' : 's'}. Choose "Save as PDF" as the destination.</span>
</div>
${pages}
${autoPrint ? '<script>window.addEventListener("load", function () { setTimeout(function () { window.print(); }, 300); });</script>' : ''}
</body>
</html>
`;
}

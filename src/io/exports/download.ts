/**
 * Thin browser delivery helpers: trigger a download of a Blob, or open an
 * HTML document (the print-to-PDF path) in a new tab.
 */

export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  a.style.display = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export class PopupBlockedError extends Error {
  constructor() {
    super('The browser blocked the new tab. Allow pop-ups for this site and try again.');
    this.name = 'PopupBlockedError';
  }
}

/** Open a Blob (HTML for printing, or an image / SVG to look at) in a new tab. Throws when pop-ups are blocked. */
export function openBlobInNewTab(blob: Blob): Window {
  const url = URL.createObjectURL(blob);
  const win = window.open(url, '_blank', 'noopener');
  if (!win) {
    URL.revokeObjectURL(url);
    throw new PopupBlockedError();
  }
  // Give the new document time to load before the URL is revoked.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return win;
}

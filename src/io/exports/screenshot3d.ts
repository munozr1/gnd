/**
 * 3D screenshot (PNG). The 3D viewer owns the WebGL canvas, so it publishes a
 * capture function on `window.__dcCapture3D` while it is mounted (the canvas
 * must be rendered with `preserveDrawingBuffer` or re-rendered inside the
 * capture). The function may return a Blob, a data URL, a canvas, or a
 * promise of any of those; this module normalises the result to a PNG Blob.
 *
 * Contract for the viewer:
 *   registerCapture3D(() => Promise<Blob>)   // on mount
 *   unregisterCapture3D()                    // on unmount
 */
export const CAPTURE_3D_KEY = '__dcCapture3D';

export type Capture3DResult = Blob | string | HTMLCanvasElement;
export type Capture3D = () => Capture3DResult | Promise<Capture3DResult>;

export const VIEWER_NOT_OPEN_MESSAGE = 'The 3D viewer has not been opened yet. Open the 3D tab (Alt+3) and try again.';

export class Viewer3dNotOpenError extends Error {
  constructor() {
    super(VIEWER_NOT_OPEN_MESSAGE);
    this.name = 'Viewer3dNotOpenError';
  }
}

type CaptureHost = { [CAPTURE_3D_KEY]?: Capture3D | undefined };

const host = (): CaptureHost | null => (typeof window === 'undefined' ? null : (window as unknown as CaptureHost));

export function registerCapture3D(fn: Capture3D): () => void {
  const h = host();
  if (h) h[CAPTURE_3D_KEY] = fn;
  return () => {
    const hh = host();
    if (hh && hh[CAPTURE_3D_KEY] === fn) delete hh[CAPTURE_3D_KEY];
  };
}

export function unregisterCapture3D(): void {
  const h = host();
  if (h) delete h[CAPTURE_3D_KEY];
}

export function capture3DAvailable(): boolean {
  return typeof host()?.[CAPTURE_3D_KEY] === 'function';
}

function dataUrlToBlob(dataUrl: string): Blob {
  const m = /^data:([^;,]+)?((?:;[^;,]+)*?)(;base64)?,(.*)$/s.exec(dataUrl);
  if (!m) throw new Error('3D capture returned an unrecognised data URL');
  const mime = m[1] ?? 'image/png';
  const payload = m[4] ?? '';
  if (m[3]) {
    const bin = atob(payload);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: mime });
  }
  return new Blob([decodeURIComponent(payload)], { type: mime });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    if (typeof canvas.toBlob === 'function') {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('3D capture produced an empty image'))), 'image/png');
    } else {
      try {
        resolve(dataUrlToBlob(canvas.toDataURL('image/png')));
      } catch (err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    }
  });
}

/** PNG of the current 3D view. Throws `Viewer3dNotOpenError` when no viewer has registered a capture. */
export async function capture3dPng(): Promise<Blob> {
  const fn = host()?.[CAPTURE_3D_KEY];
  if (typeof fn !== 'function') throw new Viewer3dNotOpenError();
  const result = await fn();
  if (result instanceof Blob) return result;
  if (typeof result === 'string') return dataUrlToBlob(result);
  if (typeof HTMLCanvasElement !== 'undefined' && result instanceof HTMLCanvasElement) return canvasToBlob(result);
  throw new Error('3D capture returned an unsupported value');
}

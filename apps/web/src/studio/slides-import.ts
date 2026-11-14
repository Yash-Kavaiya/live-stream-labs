import { MAX_SLIDES } from '@studio/shared';
import { api } from '../lib/api';

/**
 * Turns a PDF (exported from PowerPoint, Google Slides, Keynote...) or a set of images into slide
 * pictures, uploaded as assets. Every slide is drawn at full program width onto white, so a
 * transparent PNG or a 4:3 deck looks the same on the stream as in the editor.
 */

const WIDTH = 1920;
const QUALITY = 0.88;

export const SLIDE_ACCEPT = 'application/pdf,image/png,image/jpeg,image/webp';

function toJpeg(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) =>
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not encode the slide'))), 'image/jpeg', QUALITY),
  );
}

function whiteCanvas(width: number, height: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width);
  canvas.height = Math.round(height);
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  return [canvas, ctx];
}

async function* pdfPages(file: File): AsyncGenerator<Blob> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    for (let n = 1; n <= doc.numPages; n++) {
      const page = await doc.getPage(n);
      const base = page.getViewport({ scale: 1 });
      // Full width, but a tall page is capped so it does not become a huge picture.
      const scale = Math.min(WIDTH / base.width, WIDTH / base.height);
      const viewport = page.getViewport({ scale });
      const [canvas, ctx] = whiteCanvas(viewport.width, viewport.height);
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      page.cleanup();
      yield toJpeg(canvas);
    }
  } finally {
    void task.destroy();
  }
}

async function imageSlide(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, WIDTH / bitmap.width, WIDTH / bitmap.height);
  const [canvas, ctx] = whiteCanvas(bitmap.width * scale, bitmap.height * scale);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return toJpeg(canvas);
}

/** How many pages the files hold, for the progress bar. Images count one each. */
async function countPages(files: File[]): Promise<number> {
  let total = 0;
  for (const file of files) {
    if (file.type !== 'application/pdf') {
      total += 1;
      continue;
    }
    const pdfjs = await import('pdfjs-dist');
    const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
    pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
    const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
    total += (await task.promise).numPages;
    void task.destroy();
  }
  return total;
}

/**
 * Uploads every page of every file, in order. `room` is how many more slides the deck can take;
 * pages past it are left out. Reports progress as (done, total).
 */
export async function importSlides(
  broadcastId: string,
  files: File[],
  room: number,
  onProgress: (done: number, total: number) => void,
): Promise<{ urls: string[]; skipped: number }> {
  const sorted = [...files].sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  const total = await countPages(sorted);
  const limit = Math.min(total, room, MAX_SLIDES);
  const urls: string[] = [];
  onProgress(0, limit);

  const upload = async (blob: Blob) => {
    urls.push((await api.uploadAsset(broadcastId, blob)).url);
    onProgress(urls.length, limit);
  };

  for (const file of sorted) {
    if (urls.length >= limit) break;
    if (file.type === 'application/pdf') {
      for await (const blob of pdfPages(file)) {
        if (urls.length >= limit) break;
        await upload(blob);
      }
    } else if (file.type.startsWith('image/')) {
      await upload(await imageSlide(file));
    }
  }
  return { urls, skipped: total - urls.length };
}

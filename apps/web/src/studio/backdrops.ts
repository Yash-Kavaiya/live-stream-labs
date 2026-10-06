/**
 * Built-in pictures, painted in code so the app ships no image files. They serve as virtual
 * camera backgrounds and as backgrounds for the program.
 */
export interface Backdrop {
  id: string;
  label: string;
  paint(ctx: CanvasRenderingContext2D, width: number, height: number): void;
}

/** A small repeatable random source, so a backdrop looks the same every time it is painted. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) % 4294967296;
    return state / 4294967296;
  };
}

function fillGradient(ctx: CanvasRenderingContext2D, w: number, h: number, stops: string[], angle = 90): void {
  const rad = (angle * Math.PI) / 180;
  const dx = (Math.cos(rad) * w) / 2;
  const dy = (Math.sin(rad) * h) / 2;
  const gradient = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
  stops.forEach((color, i) => gradient.addColorStop(i / (stops.length - 1), color));
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, w, h);
}

/** Soft, out-of-focus lights. */
function bokeh(ctx: CanvasRenderingContext2D, w: number, h: number, colors: string[], seed: number, count: number): void {
  const random = seeded(seed);
  for (let i = 0; i < count; i++) {
    const x = random() * w;
    const y = random() * h;
    const radius = (0.04 + random() * 0.1) * w;
    const color = colors[Math.floor(random() * colors.length)]!;
    const glow = ctx.createRadialGradient(x, y, 0, x, y, radius);
    glow.addColorStop(0, `${color}55`);
    glow.addColorStop(0.6, `${color}22`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }
}

function vignette(ctx: CanvasRenderingContext2D, w: number, h: number, strength: number): void {
  const shade = ctx.createRadialGradient(w / 2, h / 2, h * 0.3, w / 2, h / 2, w * 0.75);
  shade.addColorStop(0, 'rgb(0 0 0 / 0)');
  shade.addColorStop(1, `rgb(0 0 0 / ${strength})`);
  ctx.fillStyle = shade;
  ctx.fillRect(0, 0, w, h);
}

export const BACKDROPS: Backdrop[] = [
  {
    id: 'studio',
    label: 'Studio',
    paint(ctx, w, h) {
      fillGradient(ctx, w, h, ['#0b1b3a', '#12306b', '#0b1b3a'], 20);
      bokeh(ctx, w, h, ['#4c8dff', '#9bc1ff', '#ffffff'], 7, 18);
      vignette(ctx, w, h, 0.45);
    },
  },
  {
    id: 'sunset',
    label: 'Sunset',
    paint(ctx, w, h) {
      fillGradient(ctx, w, h, ['#2b1055', '#b0306a', '#f7773d', '#ffd27a']);
      const sun = ctx.createRadialGradient(w * 0.68, h * 0.62, 0, w * 0.68, h * 0.62, h * 0.32);
      sun.addColorStop(0, '#fff3c4');
      sun.addColorStop(0.25, '#ffd98a');
      sun.addColorStop(1, '#ffd98a00');
      ctx.fillStyle = sun;
      ctx.fillRect(0, 0, w, h);
      // Two ranges of hills in front of the sun.
      const hills: [string, number, number][] = [['#5a1e52', 0.74, 3], ['#2a0f33', 0.84, 11]];
      for (const [color, base, seed] of hills) {
        const random = seeded(seed);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, h);
        for (let x = 0; x <= w; x += w / 8) ctx.lineTo(x, h * (base - random() * 0.08));
        ctx.lineTo(w, h);
        ctx.fill();
      }
    },
  },
  {
    id: 'loft',
    label: 'Loft',
    paint(ctx, w, h) {
      fillGradient(ctx, w, h, ['#f3efe8', '#e3dccf', '#cfc6b6']);
      // Daylight falling across the wall from a window out of frame.
      ctx.save();
      ctx.transform(1, 0, -0.35, 1, 0, 0);
      ctx.fillStyle = 'rgb(255 255 255 / 0.45)';
      for (let i = 0; i < 3; i++) ctx.fillRect(w * (0.42 + i * 0.16), 0, w * 0.11, h * 0.7);
      ctx.restore();
      ctx.fillStyle = '#b9ad98';
      ctx.fillRect(0, h * 0.86, w, h * 0.14);
      vignette(ctx, w, h, 0.18);
    },
  },
  {
    id: 'forest',
    label: 'Forest',
    paint(ctx, w, h) {
      fillGradient(ctx, w, h, ['#0d2b1d', '#1d5a3a', '#0d2b1d'], 60);
      bokeh(ctx, w, h, ['#b7f397', '#f4ffb0', '#5fd38d'], 23, 22);
      vignette(ctx, w, h, 0.4);
    },
  },
  {
    id: 'night',
    label: 'City night',
    paint(ctx, w, h) {
      fillGradient(ctx, w, h, ['#05060f', '#111634', '#241a3d']);
      bokeh(ctx, w, h, ['#ffb74d', '#ff5c8a', '#6ad1ff', '#fff2b3'], 41, 30);
      vignette(ctx, w, h, 0.5);
    },
  },
  {
    id: 'paper',
    label: 'Soft light',
    paint(ctx, w, h) {
      fillGradient(ctx, w, h, ['#dfe9f7', '#f6f1fb', '#fde8e4'], 30);
      bokeh(ctx, w, h, ['#ffffff'], 5, 10);
    },
  },
];

function render(backdrop: Backdrop, width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  backdrop.paint(canvas.getContext('2d')!, width, height);
  return canvas;
}

const urls = new Map<string, string>();

/**
 * A backdrop as a JPEG data URL, or null for an id that no longer exists. Full HD by default: a
 * virtual background is stretched over the whole camera frame, so a smaller picture looks soft.
 */
export function backdropUrl(id: string, width = 1920, height = 1080): string | null {
  const backdrop = BACKDROPS.find((b) => b.id === id);
  if (!backdrop) return null;
  const key = `${id}@${width}`;
  let url = urls.get(key);
  if (!url) {
    url = render(backdrop, width, height).toDataURL('image/jpeg', 0.95);
    urls.set(key, url);
  }
  return url;
}

/** A backdrop as an image file, ready to upload. */
export function backdropFile(id: string): Promise<File> {
  const backdrop = BACKDROPS.find((b) => b.id === id);
  if (!backdrop) return Promise.reject(new Error('Unknown backdrop'));
  return new Promise((resolve, reject) => {
    render(backdrop, 1920, 1080).toBlob(
      (blob) => (blob ? resolve(new File([blob], `${id}.jpg`, { type: 'image/jpeg' })) : reject(new Error('Could not paint the backdrop'))),
      'image/jpeg',
      0.9,
    );
  });
}

/** Scales and crops a picture to 1920×1080 and returns it as a data URL small enough to remember. */
export async function pictureToDataUrl(file: File): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  canvas.width = 1920;
  canvas.height = 1080;
  const scale = Math.max(canvas.width / bitmap.width, canvas.height / bitmap.height);
  const width = bitmap.width * scale;
  const height = bitmap.height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
  bitmap.close();
  return canvas.toDataURL('image/jpeg', 0.92);
}

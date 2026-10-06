import {
  activeBanner,
  computeLayout,
  fitRect,
  parseSourceId,
  PROGRAM_SIZE,
  type Scene,
  type Size,
  type Tile,
} from '@studio/shared';

/** What the compositor needs to know about a source to draw it. */
export interface DrawableSource {
  label: string;
  /** Null when there is no picture (camera off): a name card is drawn instead. */
  frame: HTMLVideoElement | HTMLImageElement | null;
}

const FONT = "'Google Sans Flex', 'Google Sans', 'Roboto Flex', Roboto, system-ui, sans-serif";
const BACKDROP = '#101114';
const TILE_EMPTY = '#282a2c';
const FPS = 30;

/** Loads scene images once and hands back the element when it is ready to draw. */
class ImageCache {
  private readonly images = new Map<string, HTMLImageElement>();

  get(url: string | null | undefined): HTMLImageElement | null {
    if (!url) return null;
    let img = this.images.get(url);
    if (!img) {
      img = new Image();
      img.src = url; // Same-origin (/assets/...), so the canvas stays untainted and capturable.
      this.images.set(url, img);
    }
    return img.complete && img.naturalWidth > 0 ? img : null;
  }
}

function frameSize(frame: HTMLVideoElement | HTMLImageElement): Size | null {
  const width = frame instanceof HTMLVideoElement ? frame.videoWidth : frame.naturalWidth;
  const height = frame instanceof HTMLVideoElement ? frame.videoHeight : frame.naturalHeight;
  return width > 0 && height > 0 ? { width, height } : null;
}

function readableOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const luminance = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return luminance > 0.6 ? '#1f1f1f' : '#ffffff';
}

/**
 * Draws the program: the one picture that viewers see. The same class renders the studio preview,
 * the guest view and the server-side `/render` page, so they cannot disagree.
 *
 * It is driven by a Worker timer rather than requestAnimationFrame, because browsers pause rAF in
 * background tabs and the stream must keep going when the host looks at another tab.
 */
export class Compositor {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly images = new ImageCache();
  private readonly size: Size;
  private scene: Scene | null = null;
  private sources = new Map<string, DrawableSource>();
  private ticker: Worker | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    size: Size = PROGRAM_SIZE,
  ) {
    this.size = size;
    canvas.width = size.width;
    canvas.height = size.height;
    this.ctx = canvas.getContext('2d', { alpha: false })!;
  }

  update(scene: Scene, sources: Map<string, DrawableSource>): void {
    this.scene = scene;
    this.sources = sources;
  }

  start(): void {
    if (this.ticker) return;
    this.ticker = new Worker(new URL('./ticker.worker.ts', import.meta.url), { type: 'module' });
    this.ticker.onmessage = () => this.draw(performance.now());
    this.ticker.postMessage(1000 / FPS);
    this.draw(performance.now());
  }

  stop(): void {
    this.ticker?.terminate();
    this.ticker = null;
  }

  draw(now: number): void {
    const { ctx, size, scene } = this;
    ctx.fillStyle = BACKDROP;
    ctx.fillRect(0, 0, size.width, size.height);
    if (!scene) return;

    const background = this.images.get(scene.brand.backgroundUrl);
    if (background) this.drawFrame(background, { x: 0, y: 0, ...size, fit: 'cover' });

    // Sources whose participant has left are skipped, so the layout closes the gap at once.
    const present = scene.stage.filter((id) => (id === 'media' ? scene.media : this.sources.has(id)));
    for (const tile of computeLayout(scene.layout, present, size)) this.drawTile(tile, scene);

    const overlay = this.images.get(scene.brand.overlayUrl);
    if (overlay) this.drawFrame(overlay, { x: 0, y: 0, ...size, fit: 'cover' });

    this.drawLogo(scene);
    this.drawBanner(scene, now);
    this.drawComment(scene);
  }

  private get unit(): number {
    return this.size.height / 100;
  }

  private drawFrame(
    frame: HTMLVideoElement | HTMLImageElement,
    dst: Pick<Tile, 'x' | 'y' | 'width' | 'height' | 'fit'>,
  ): boolean {
    const src = frameSize(frame);
    if (!src) return false;
    const r = fitRect(src.width, src.height, dst);
    this.ctx.drawImage(frame, r.sx, r.sy, r.sw, r.sh, r.dx, r.dy, r.dw, r.dh);
    return true;
  }

  private drawTile(tile: Tile, scene: Scene): void {
    const { ctx, unit } = this;
    const isMedia = tile.id === 'media';
    const source = this.sources.get(tile.id);
    const frame = isMedia ? this.images.get(scene.media?.url) : (source?.frame ?? null);
    const label = source?.label ?? '';

    ctx.save();
    ctx.beginPath();
    ctx.roundRect(tile.x, tile.y, tile.width, tile.height, tile.radius);
    ctx.clip();
    ctx.fillStyle = tile.fit === 'contain' ? '#000000' : TILE_EMPTY;
    ctx.fillRect(tile.x, tile.y, tile.width, tile.height);

    const drawn = frame ? this.drawFrame(frame, tile) : false;
    if (!drawn && !isMedia) this.drawNameCard(tile, label, scene.brand.color);

    if (scene.brand.showNames && parseSourceId(tile.id).kind === 'cam' && label && tile.height > unit * 22) {
      this.drawNameTag(tile, label, scene.brand.color);
    }
    ctx.restore();
  }

  /** Camera off: a coloured disc with the participant's initial. */
  private drawNameCard(tile: Tile, label: string, color: string): void {
    const { ctx } = this;
    const r = Math.min(tile.width, tile.height) * 0.2;
    const cx = tile.x + tile.width / 2;
    const cy = tile.y + tile.height / 2;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = readableOn(color);
    ctx.font = `500 ${r}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText((label.trim()[0] ?? '?').toUpperCase(), cx, cy + r * 0.05);
  }

  private drawNameTag(tile: Tile, label: string, color: string): void {
    const { ctx, unit } = this;
    const fontSize = Math.max(unit * 2.2, Math.min(unit * 3.4, tile.height * 0.075));
    const padX = fontSize * 0.7;
    const height = fontSize * 1.9;
    ctx.font = `500 ${fontSize}px ${FONT}`;
    const text = this.ellipsize(label, tile.width * 0.7 - padX * 2);
    const width = ctx.measureText(text).width + padX * 2;
    const x = tile.x + fontSize * 0.6;
    const y = tile.y + tile.height - height - fontSize * 0.6;

    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fill();
    ctx.fillStyle = readableOn(color);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX, y + height / 2 + fontSize * 0.04);
  }

  private drawLogo(scene: Scene): void {
    const logo = this.images.get(scene.brand.logoUrl);
    if (!logo) return;
    const { unit, size } = this;
    const box = unit * 12;
    const scale = Math.min(box / logo.naturalWidth, box / logo.naturalHeight);
    const w = logo.naturalWidth * scale;
    const h = logo.naturalHeight * scale;
    this.ctx.drawImage(logo, size.width - w - unit * 3, unit * 3, w, h);
  }

  private drawBanner(scene: Scene, now: number): void {
    const banner = activeBanner(scene);
    if (!banner) return;
    const { ctx, unit, size } = this;
    const color = scene.brand.color;
    const fontSize = unit * 4;
    ctx.font = `500 ${fontSize}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    if (banner.style === 'ticker') {
      const height = fontSize * 1.9;
      const y = size.height - height;
      ctx.fillStyle = color;
      ctx.fillRect(0, y, size.width, height);
      ctx.fillStyle = readableOn(color);
      // Scroll right to left, repeating with a gap, at a speed that is easy to read.
      const text = `${banner.text}     •     `;
      const textWidth = ctx.measureText(text).width;
      const offset = ((now / 1000) * unit * 14) % textWidth;
      for (let x = -offset; x < size.width; x += textWidth) ctx.fillText(text, x, y + height / 2);
      return;
    }

    const padX = fontSize * 0.9;
    const height = fontSize * 2.1;
    const maxWidth = size.width * 0.8;
    const text = this.ellipsize(banner.text, maxWidth - padX * 2);
    const width = Math.min(maxWidth, ctx.measureText(text).width + padX * 2);
    const x = unit * 4;
    const y = size.height - height - unit * 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, unit * 1.6);
    ctx.fill();
    ctx.fillStyle = readableOn(color);
    ctx.fillText(text, x + padX, y + height / 2 + fontSize * 0.04);
  }

  private drawComment(scene: Scene): void {
    const comment = scene.comment;
    if (!comment) return;
    const { ctx, unit, size } = this;
    const width = size.width * 0.62;
    const pad = unit * 2.6;
    const authorSize = unit * 2.8;
    const textSize = unit * 3.6;

    ctx.font = `400 ${textSize}px ${FONT}`;
    const lines = this.wrap(comment.text, width - pad * 2, 3);
    const height = pad * 2 + authorSize * 1.5 + lines.length * textSize * 1.3;
    const x = (size.width - width) / 2;
    const liftForBanner = activeBanner(scene) ? unit * 16 : 0;
    const y = size.height - height - unit * 6 - liftForBanner;

    ctx.fillStyle = '#ffffff';
    ctx.shadowColor = 'rgb(0 0 0 / 0.35)';
    ctx.shadowBlur = unit * 2;
    ctx.shadowOffsetY = unit * 0.5;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, unit * 2.2);
    ctx.fill();
    ctx.shadowColor = 'transparent';

    // Accent bar in the brand colour.
    ctx.fillStyle = scene.brand.color;
    ctx.beginPath();
    ctx.roundRect(x, y, unit * 1, height, [unit * 2.2, 0, 0, unit * 2.2]);
    ctx.fill();

    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#444746';
    ctx.font = `500 ${authorSize}px ${FONT}`;
    const via = comment.platform && comment.platform !== 'studio' ? `  ·  ${comment.platform}` : '';
    ctx.fillText(this.ellipsize(`${comment.author}${via}`, width - pad * 2), x + pad, y + pad);
    ctx.fillStyle = '#1f1f1f';
    ctx.font = `400 ${textSize}px ${FONT}`;
    lines.forEach((line, i) => {
      ctx.fillText(line, x + pad, y + pad + authorSize * 1.5 + i * textSize * 1.3);
    });
  }

  private ellipsize(text: string, maxWidth: number): string {
    const { ctx } = this;
    if (ctx.measureText(text).width <= maxWidth) return text;
    let cut = text.length;
    while (cut > 1 && ctx.measureText(`${text.slice(0, cut)}…`).width > maxWidth) cut--;
    return `${text.slice(0, cut).trimEnd()}…`;
  }

  /** Greedy word wrap; whatever does not fit in `maxLines` is ellipsized on the last line. */
  private wrap(text: string, maxWidth: number, maxLines: number): string[] {
    const words = text.split(/\s+/).filter(Boolean);
    const lines: string[] = [];
    let line = '';
    for (const [i, word] of words.entries()) {
      const next = line ? `${line} ${word}` : word;
      if (!line || this.ctx.measureText(next).width <= maxWidth) {
        line = next;
        continue;
      }
      if (lines.length === maxLines - 1) {
        line = `${line} ${words.slice(i).join(' ')}`;
        break;
      }
      lines.push(line);
      line = word;
    }
    lines.push(this.ellipsize(line, maxWidth));
    return lines;
  }
}

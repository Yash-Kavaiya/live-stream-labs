import {
  activeBanner,
  computeLayout,
  Fade,
  fitRect,
  parseSourceId,
  PROGRAM_SIZE,
  SCREEN_LABELS,
  TEMPLATES,
  TileAnimator,
  type AnimatedTile,
  type Banner,
  type OnScreenComment,
  type Scene,
  type ScreenId,
  type Size,
  type TemplateId,
  type Tile,
} from '@studio/shared';

/** What the compositor needs to know about a source to draw it. */
export interface DrawableSource {
  label: string;
  /** Null when there is no picture (camera off): a name card is drawn instead. */
  frame: HTMLVideoElement | HTMLImageElement | null;
  speaking: boolean;
}

const FONT = "'Google Sans Flex', 'Google Sans', 'Roboto Flex', Roboto, system-ui, sans-serif";
const TILE_EMPTY = '#282a2c';
const SPEAKING = '#34A853';
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

/** An overlay that keeps drawing its last content while it fades out. */
class FadingOverlay<T> {
  private readonly fade = new Fade();
  private last: T | null = null;

  /** Returns what to draw and how opaque, or null when fully gone. */
  step(current: T | null, dt: number): { value: T; alpha: number } | null {
    if (current) this.last = current;
    const alpha = this.fade.step(current !== null, dt);
    if (alpha <= 0 || !this.last) return null;
    return { value: this.last, alpha };
  }
}

/**
 * Draws the program: the one picture that viewers see. The same class renders the studio preview,
 * the guest view and the server-side `/render` page, so they cannot disagree.
 *
 * Nothing jumps: tiles glide between layouts and overlays fade, driven by the time between frames.
 * The loop runs on a Worker timer rather than requestAnimationFrame, because browsers pause rAF in
 * background tabs and the stream must keep going when the host looks at another tab.
 */
export class Compositor {
  private readonly ctx: CanvasRenderingContext2D;
  private readonly images = new ImageCache();
  private readonly size: Size;
  private readonly tiles = new TileAnimator();
  private readonly speakingRings = new Map<string, Fade>();
  private readonly banner = new FadingOverlay<Banner>();
  private readonly comment = new FadingOverlay<OnScreenComment>();
  private readonly holding = new FadingOverlay<{ screen: ScreenId; message: string }>();
  private readonly themed = new FadingOverlay<TemplateId>();
  private scene: Scene | null = null;
  private sources = new Map<string, DrawableSource>();
  private ticker: Worker | null = null;
  private lastDraw = 0;
  /** Height already taken at the bottom edge by full-width strips, so later overlays stack above. */
  private bottomInset = 0;
  /** Where the lower-third banner sat last frame and how visible it was; name tags under it step aside. */
  private bannerZone = { top: Infinity, alpha: 0 };

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
    // Cap the step so a stalled tab resumes with a short glide, not a teleport.
    const dt = this.lastDraw ? Math.min(100, now - this.lastDraw) : 0;
    this.lastDraw = now;
    this.bottomInset = 0;

    ctx.globalAlpha = 1;
    ctx.fillStyle = TEMPLATES.none.backdrop[0];
    ctx.fillRect(0, 0, size.width, size.height);
    if (!scene) return;

    const themed = this.themed.step(scene.template === 'none' ? null : scene.template, dt);
    if (themed) this.withAlpha(themed.alpha, () => this.drawBackdrop(themed.value));

    const background = this.images.get(scene.brand.backgroundUrl);
    if (background) this.drawFrame(background, { x: 0, y: 0, ...size, fit: 'cover' });

    // Sources whose participant has left are skipped, so the layout closes the gap.
    const present = scene.stage.filter((id) => (id === 'media' ? scene.media : this.sources.has(id)));
    const targets = computeLayout(scene.layout, present, size);
    for (const tile of this.tiles.step(targets, dt)) this.drawTile(tile, scene, dt);

    const overlay = this.images.get(scene.brand.overlayUrl);
    if (overlay) this.drawFrame(overlay, { x: 0, y: 0, ...size, fit: 'cover' });

    if (themed) this.withAlpha(themed.alpha, () => this.drawTemplateFurniture(themed.value, scene, now));
    this.drawLogo(scene);

    const banner = this.banner.step(activeBanner(scene), dt);
    this.bannerZone = { top: Infinity, alpha: 0 };
    if (banner) this.drawBanner(banner.value, banner.alpha, scene, now);
    const comment = this.comment.step(scene.comment, dt);
    if (comment) this.drawComment(comment.value, comment.alpha, scene);

    const holding = this.holding.step(
      scene.screen === 'live' ? null : { screen: scene.screen, message: scene.screenMessage },
      dt,
    );
    if (holding) this.withAlpha(holding.alpha, () => this.drawHoldingScreen(holding.value, scene, now));
  }

  private get unit(): number {
    return this.size.height / 100;
  }

  private withAlpha(alpha: number, paint: () => void): void {
    const previous = this.ctx.globalAlpha;
    this.ctx.globalAlpha = previous * alpha;
    paint();
    this.ctx.globalAlpha = previous;
  }

  private gradient(colors: [string, string]): CanvasGradient {
    const gradient = this.ctx.createLinearGradient(0, 0, this.size.width * 0.3, this.size.height);
    gradient.addColorStop(0, colors[0]);
    gradient.addColorStop(1, colors[1]);
    return gradient;
  }

  // ---------- Tiles ----------

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

  private drawTile(tile: AnimatedTile, scene: Scene, dt: number): void {
    const { ctx, unit } = this;
    const isMedia = tile.id === 'media';
    const source = this.sources.get(tile.id);
    const frame = isMedia ? this.images.get(scene.media?.url) : (source?.frame ?? null);
    const label = source?.label ?? '';
    const isCam = parseSourceId(tile.id).kind === 'cam';

    ctx.save();
    ctx.globalAlpha *= Math.min(1, Math.max(0, tile.opacity));
    ctx.beginPath();
    ctx.roundRect(tile.x, tile.y, tile.width, tile.height, tile.radius);
    ctx.save();
    ctx.clip();
    ctx.fillStyle = tile.fit === 'contain' ? '#000000' : TILE_EMPTY;
    ctx.fillRect(tile.x, tile.y, tile.width, tile.height);

    const drawn = frame ? this.drawFrame(frame, tile) : false;
    if (!drawn && !isMedia) this.drawNameCard(tile, label, scene.brand.color);
    if (scene.brand.showNames && isCam && label && tile.height > unit * 22) {
      this.drawNameTag(tile, label, scene.brand.color);
    }
    ctx.restore();

    // Themed looks frame each tile so it reads against the gradient.
    if (scene.template !== 'none' && tile.radius > 0) {
      ctx.strokeStyle = 'rgb(255 255 255 / 0.22)';
      ctx.lineWidth = unit * 0.3;
      ctx.stroke();
    }

    const ring = this.speakingRing(tile.id, isCam && scene.auto.highlightSpeaker && !!source?.speaking, dt);
    if (ring > 0) {
      ctx.globalAlpha *= ring;
      ctx.strokeStyle = SPEAKING;
      ctx.lineWidth = unit * 0.9;
      // Inset by half the line so a full-bleed tile still shows the whole ring.
      const inset = ctx.lineWidth / 2;
      ctx.beginPath();
      ctx.roundRect(tile.x + inset, tile.y + inset, tile.width - 2 * inset, tile.height - 2 * inset, Math.max(0, tile.radius - inset));
      ctx.stroke();
    }
    ctx.restore();
  }

  private speakingRing(id: string, speaking: boolean, dt: number): number {
    let fade = this.speakingRings.get(id);
    if (!fade) {
      if (!speaking) return 0;
      fade = new Fade(200);
      this.speakingRings.set(id, fade);
    }
    const alpha = fade.step(speaking, dt);
    if (alpha <= 0) this.speakingRings.delete(id);
    return alpha;
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

    // A banner covers the bottom-left of the frame; fade out a name tag it would sit on.
    const covered = y + height > this.bannerZone.top && x < this.size.width * 0.8;
    ctx.save();
    if (covered) ctx.globalAlpha *= 1 - this.bannerZone.alpha;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, height / 2);
    ctx.fill();
    ctx.fillStyle = readableOn(color);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX, y + height / 2 + fontSize * 0.04);
    ctx.restore();
  }

  // ---------- Templates ----------

  private drawBackdrop(template: TemplateId): void {
    const { ctx, size, unit } = this;
    ctx.fillStyle = this.gradient(TEMPLATES[template].backdrop);
    ctx.fillRect(0, 0, size.width, size.height);
    const accent = TEMPLATES[template].accent;

    if (template === 'sports') {
      // Diagonal speed stripes in the top-right corner.
      ctx.save();
      ctx.translate(size.width, 0);
      ctx.rotate(Math.PI / 4);
      [0.5, 0.28, 0.14].forEach((alpha, i) => {
        ctx.globalAlpha *= alpha;
        ctx.fillStyle = accent;
        ctx.fillRect(-size.width, unit * (10 + i * 7), size.width * 2, unit * 3.4);
      });
      ctx.restore();
    } else if (template === 'cricket') {
      // The pitch: a pale strip and a boundary arc, very faint.
      ctx.save();
      ctx.globalAlpha *= 0.1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = unit * 0.5;
      ctx.beginPath();
      ctx.ellipse(size.width / 2, size.height * 1.05, size.width * 0.62, size.height * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(size.width / 2 - unit * 5, size.height * 0.35, unit * 10, size.height * 0.5);
      ctx.restore();
    } else if (template === 'watchparty') {
      ctx.save();
      for (const [x, y, r, alpha] of [[0.12, 0.2, 26, 0.18], [0.88, 0.14, 18, 0.14], [0.8, 0.86, 34, 0.12], [0.2, 0.9, 16, 0.16]] as const) {
        ctx.globalAlpha = this.ctx.globalAlpha * alpha;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(size.width * x, size.height * y, unit * r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (template === 'newsroom') {
      // A faint world-grid of latitude lines.
      ctx.save();
      ctx.globalAlpha *= 0.08;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = unit * 0.25;
      for (let i = 1; i <= 5; i++) {
        ctx.beginPath();
        ctx.ellipse(size.width * 0.78, size.height * 0.4, unit * 12 * i, unit * 7 * i, 0, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  /** The fixed on-screen graphics of a template: bugs, labels and scoreboards. */
  private drawTemplateFurniture(template: TemplateId, scene: Scene, now: number): void {
    const { unit } = this;
    if (template === 'newsroom') {
      const clock = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      const end = this.drawPill(unit * 3, unit * 3, 'LIVE', TEMPLATES.newsroom.accent, '#ffffff', now);
      this.drawPill(end + unit, unit * 3, clock, 'rgb(0 0 0 / 0.55)', '#ffffff');
    } else if (template === 'watchparty') {
      this.drawPill(unit * 3, unit * 3, 'WATCH PARTY', scene.brand.color, readableOn(scene.brand.color), now);
    } else if (template === 'sports' && scene.scoreboard) {
      this.drawScorebug(scene);
    } else if (template === 'cricket' && scene.scoreboard) {
      this.drawCricketStrip(scene);
    }
  }

  /** A small rounded label; with `pulseAt` it gets a blinking "on air" dot. Returns its right edge. */
  private drawPill(x: number, y: number, text: string, fill: string, color: string, pulseAt?: number): number {
    const { ctx, unit } = this;
    const fontSize = unit * 2.6;
    const height = fontSize * 1.9;
    const padX = fontSize * 0.8;
    const dot = pulseAt === undefined ? 0 : fontSize * 1.1;
    ctx.font = `700 ${fontSize}px ${FONT}`;
    const width = ctx.measureText(text).width + padX * 2 + dot;

    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, unit * 1);
    ctx.fill();
    ctx.fillStyle = color;
    if (pulseAt !== undefined) {
      ctx.save();
      ctx.globalAlpha *= 0.45 + 0.55 * Math.abs(Math.sin(pulseAt / 500));
      ctx.beginPath();
      ctx.arc(x + padX + fontSize * 0.25, y + height / 2, fontSize * 0.32, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, x + padX + dot, y + height / 2 + fontSize * 0.05);
    return x + width;
  }

  /** Sports: a two-row scorebug in the top-left corner with the match info underneath. */
  private drawScorebug(scene: Scene): void {
    const { ctx, unit } = this;
    const board = scene.scoreboard!;
    const accent = scene.brand.color;
    const x = unit * 3;
    const y = unit * 3;
    const rowH = unit * 5.4;
    const nameW = unit * 20;
    const scoreW = unit * 9;
    const fontSize = unit * 3;

    ctx.fillStyle = 'rgb(8 12 20 / 0.88)';
    ctx.beginPath();
    ctx.roundRect(x, y, nameW + scoreW, rowH * 2 + (board.info ? unit * 4 : 0), unit * 1.2);
    ctx.fill();

    [[board.teamA, board.scoreA], [board.teamB, board.scoreB]].forEach(([team, score], row) => {
      const top = y + row * rowH;
      ctx.fillStyle = accent;
      ctx.fillRect(x + nameW, top + unit * 0.5, scoreW - unit * 0.5, rowH - unit);
      ctx.textBaseline = 'middle';
      ctx.font = `700 ${fontSize}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = '#ffffff';
      ctx.fillText(this.ellipsize(team!.toUpperCase(), nameW - unit * 3), x + unit * 1.6, top + rowH / 2);
      ctx.textAlign = 'center';
      ctx.fillStyle = readableOn(accent);
      ctx.fillText(this.ellipsize(score!, scoreW - unit * 1.5), x + nameW + scoreW / 2 - unit * 0.25, top + rowH / 2);
    });

    if (board.info) {
      ctx.font = `500 ${unit * 2.2}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = 'rgb(255 255 255 / 0.8)';
      ctx.fillText(this.ellipsize(board.info, nameW + scoreW - unit * 3), x + unit * 1.6, y + rowH * 2 + unit * 2);
    }
  }

  /** Cricket: the classic full-width score strip along the bottom edge. */
  private drawCricketStrip(scene: Scene): void {
    const { ctx, unit, size } = this;
    const board = scene.scoreboard!;
    const accent = scene.brand.color;
    const height = unit * 8;
    const y = size.height - height - this.bottomInset;
    const fontSize = unit * 3.4;

    ctx.fillStyle = 'rgb(4 16 9 / 0.92)';
    ctx.fillRect(0, y, size.width, height);
    ctx.fillStyle = accent;
    ctx.fillRect(0, y, size.width, unit * 0.6);

    ctx.textBaseline = 'middle';
    const mid = y + height / 2 + unit * 0.3;
    let x = unit * 3;
    const segment = (text: string, weight: number, color: string, gap: number) => {
      if (!text) return;
      ctx.font = `${weight} ${fontSize}px ${FONT}`;
      ctx.textAlign = 'left';
      ctx.fillStyle = color;
      ctx.fillText(text, x, mid);
      x += ctx.measureText(text).width + unit * gap;
    };
    segment(board.teamA.toUpperCase(), 700, '#ffffff', 1.6);
    segment(board.scoreA, 700, '#fdd663', 3);
    if (board.teamB) segment('v', 400, 'rgb(255 255 255 / 0.6)', 3);
    segment(board.teamB.toUpperCase(), 700, '#ffffff', 1.6);
    segment(board.scoreB, 700, '#fdd663', 3);

    if (board.info) {
      ctx.font = `500 ${unit * 2.8}px ${FONT}`;
      ctx.textAlign = 'right';
      ctx.fillStyle = 'rgb(255 255 255 / 0.85)';
      ctx.fillText(this.ellipsize(board.info, size.width - x - unit * 4), size.width - unit * 3, mid);
    }
    this.bottomInset += height;
  }

  // ---------- Overlays ----------

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

  private drawBanner(banner: Banner, alpha: number, scene: Scene, now: number): void {
    const { ctx, unit, size } = this;
    const color = scene.brand.color;
    const fontSize = unit * 4;
    ctx.save();
    ctx.font = `500 ${fontSize}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    if (banner.style === 'ticker') {
      const height = fontSize * 1.9;
      // Slides up from below the frame.
      const y = size.height - this.bottomInset - height * alpha;
      ctx.fillStyle = color;
      ctx.fillRect(0, y, size.width, height);
      ctx.fillStyle = readableOn(color);
      const text = `${banner.text}     •     `;
      const textWidth = ctx.measureText(text).width;
      const offset = ((now / 1000) * unit * 14) % textWidth;
      ctx.beginPath();
      ctx.rect(0, y, size.width, height);
      ctx.clip();
      for (let x = -offset; x < size.width; x += textWidth) ctx.fillText(text, x, y + height / 2);
      ctx.restore();
      this.bottomInset += height * alpha;
      return;
    }

    ctx.globalAlpha *= alpha;
    const slide = (1 - alpha) * unit * 4;
    const height = fontSize * 2.1;
    const y = size.height - height - unit * 6 - this.bottomInset + slide;
    this.bannerZone = { top: y - unit, alpha };

    if (scene.template === 'newsroom') {
      // News headline: a tag in the accent colour, then the headline on white, edge to edge.
      const x = unit * 4;
      const width = size.width - unit * 8;
      ctx.font = `700 ${fontSize * 0.7}px ${FONT}`;
      const tag = 'BREAKING';
      const tagW = ctx.measureText(tag).width + fontSize * 1.4;
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, unit * 0.8);
      ctx.fill();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, tagW, height, [unit * 0.8, 0, 0, unit * 0.8]);
      ctx.fill();
      ctx.fillStyle = readableOn(color);
      ctx.fillText(tag, x + fontSize * 0.7, y + height / 2 + fontSize * 0.04);
      ctx.fillStyle = '#1f1f1f';
      ctx.font = `700 ${fontSize}px ${FONT}`;
      ctx.fillText(this.ellipsize(banner.text, width - tagW - fontSize * 1.6), x + tagW + fontSize * 0.8, y + height / 2 + fontSize * 0.04);
    } else {
      const padX = fontSize * 0.9;
      const maxWidth = size.width * 0.8;
      const text = this.ellipsize(banner.text, maxWidth - padX * 2);
      const width = Math.min(maxWidth, ctx.measureText(text).width + padX * 2);
      const x = unit * 4;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, width, height, unit * 1.6);
      ctx.fill();
      ctx.fillStyle = readableOn(color);
      ctx.fillText(text, x + padX, y + height / 2 + fontSize * 0.04);
    }
    ctx.restore();
    this.bottomInset += (height + unit * 4) * alpha;
  }

  private drawComment(comment: OnScreenComment, alpha: number, scene: Scene): void {
    const { ctx, unit, size } = this;
    const width = size.width * 0.62;
    const pad = unit * 2.6;
    const authorSize = unit * 2.8;
    const textSize = unit * 3.6;

    ctx.save();
    ctx.globalAlpha *= alpha;
    ctx.font = `400 ${textSize}px ${FONT}`;
    const lines = this.wrap(comment.text, width - pad * 2, 3);
    const height = pad * 2 + authorSize * 1.5 + lines.length * textSize * 1.3;
    const x = (size.width - width) / 2;
    const y = size.height - height - unit * 6 - this.bottomInset + (1 - alpha) * unit * 4;

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
    const via = comment.platform && comment.platform !== 'Studio' ? `  ·  ${comment.platform}` : '';
    ctx.fillText(this.ellipsize(`${comment.author}${via}`, width - pad * 2), x + pad, y + pad);
    ctx.fillStyle = '#1f1f1f';
    ctx.font = `400 ${textSize}px ${FONT}`;
    lines.forEach((line, i) => {
      ctx.fillText(line, x + pad, y + pad + authorSize * 1.5 + i * textSize * 1.3);
    });
    ctx.restore();
  }

  /** Starting soon / Be right back / Thanks for watching: covers the whole frame. */
  private drawHoldingScreen(holding: { screen: ScreenId; message: string }, scene: Scene, now: number): void {
    const { ctx, unit, size } = this;
    const color = scene.brand.color;
    const backdrop = scene.template === 'none' ? (['#17191c', '#0b0c0e'] as [string, string]) : TEMPLATES[scene.template].backdrop;
    ctx.fillStyle = this.gradient(backdrop);
    ctx.fillRect(0, 0, size.width, size.height);

    // A soft glow in the brand colour behind the title.
    const glow = ctx.createRadialGradient(size.width / 2, size.height / 2, 0, size.width / 2, size.height / 2, size.width * 0.5);
    glow.addColorStop(0, `${color}55`);
    glow.addColorStop(1, `${color}00`);
    ctx.fillStyle = glow;
    ctx.fillRect(0, 0, size.width, size.height);

    const logo = this.images.get(scene.brand.logoUrl);
    const cx = size.width / 2;
    let y = size.height * 0.44;
    if (logo) {
      const scale = Math.min((unit * 18) / logo.naturalWidth, (unit * 18) / logo.naturalHeight);
      ctx.drawImage(logo, cx - (logo.naturalWidth * scale) / 2, y - unit * 30, logo.naturalWidth * scale, logo.naturalHeight * scale);
    }

    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';
    ctx.font = `500 ${unit * 10}px ${FONT}`;
    ctx.fillText(SCREEN_LABELS[holding.screen], cx, y);
    y += unit * 10;

    if (holding.message) {
      ctx.font = `400 ${unit * 4}px ${FONT}`;
      ctx.fillStyle = 'rgb(255 255 255 / 0.82)';
      ctx.fillText(this.ellipsize(holding.message, size.width * 0.8), cx, y);
      y += unit * 8;
    }

    if (holding.screen !== 'ending') {
      // Three dots that light up in turn, so viewers can see the stream is alive.
      const phase = (now / 450) % 3;
      for (let i = 0; i < 3; i++) {
        // Distance from this dot to the moving highlight, around a ring of three.
        const distance = Math.abs(((phase - i + 4.5) % 3) - 1.5);
        ctx.save();
        ctx.globalAlpha *= 0.3 + 0.7 * Math.max(0, 1 - distance);
        ctx.fillStyle = color === '#1F1F1F' ? '#ffffff' : color;
        ctx.beginPath();
        ctx.arc(cx + (i - 1) * unit * 4, y, unit * 1.1, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    }
  }

  // ---------- Text ----------

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

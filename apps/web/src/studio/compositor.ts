import {
  activeBanner,
  computeSceneLayout,
  CRICKET_STRIP,
  Fade,
  fitRect,
  parseSourceId,
  PROGRAM_SIZE,
  formatCountdown,
  hasCountdown,
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
import { CELEBRATION_MS, drawCelebration } from './graphics/celebration';
import { drawCricketDashboard, drawCricketStrip } from './graphics/cricket';
import { drawNews } from './graphics/news';
import { drawPill, ellipsize, FONT, readableOn, wrapText, type Painter } from './graphics/painter';

/** What the compositor needs to know about a source to draw it. */
export interface DrawableSource {
  label: string;
  /** Null when there is no picture (camera off): a name card is drawn instead. */
  frame: HTMLVideoElement | HTMLImageElement | null;
  speaking: boolean;
}

const TILE_EMPTY = '#282a2c';
const SPEAKING = '#34A853';
const FPS = 30;
/** A celebration older than this when first seen has already played for everyone else. */
const CELEBRATION_STALE_MS = 8000;

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

/** What a holding screen shows. `endsAt` is the countdown target (epoch ms), or null for none. */
interface HoldingScreen {
  screen: ScreenId;
  message: string;
  endsAt: number | null;
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
  private readonly holding = new FadingOverlay<HoldingScreen>();
  private readonly themed = new FadingOverlay<TemplateId>();
  private readonly newsHeadline = new FadingOverlay<string>();
  /** The celebration being played, by id, and when (on the draw clock) it started here. */
  private celebration: { id: string; startedAt: number } | null = null;
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
    ctx.fillStyle = scene ? this.cleanBackdrop(scene) : TEMPLATES.none.backdrop[0];
    ctx.fillRect(0, 0, size.width, size.height);
    if (!scene) return;

    const themed = this.themed.step(scene.template === 'none' ? null : scene.template, dt);
    if (themed) this.withAlpha(themed.alpha, () => this.drawBackdrop(themed.value));

    const background = this.images.get(scene.brand.backgroundUrl);
    if (background) this.drawFrame(background, { x: 0, y: 0, ...size, fit: 'cover' });

    // Sources whose participant has left are skipped, so the layout closes the gap.
    const present = scene.stage.filter((id) => (id === 'media' ? scene.media : this.sources.has(id)));
    const targets = computeSceneLayout(scene, present, size);
    for (const tile of this.tiles.step(targets, dt)) this.drawTile(tile, scene, dt);

    const overlay = this.images.get(scene.brand.overlayUrl);
    if (overlay) this.drawFrame(overlay, { x: 0, y: 0, ...size, fit: 'cover' });

    // In the news room a lower-third banner is the headline: it overrides the saved one.
    const shown = activeBanner(scene);
    const isNews = scene.template === 'newsroom';
    const headlineText = isNews ? ((shown?.style === 'lower-third' ? shown.text : '') || scene.news.headline.trim()) : '';
    const headline = this.newsHeadline.step(headlineText || null, dt);
    if (themed) {
      this.withAlpha(themed.alpha, () =>
        this.drawTemplateFurniture(themed.value, scene, now, {
          headline: headline ? { text: headline.value, alpha: headline.alpha } : null,
          sideOccupied: targets.length > 1,
        }),
      );
    }
    this.drawLogo(scene);

    // The news room shows a lower-third banner as its headline, and the cricket dashboard has no
    // free space for one; a ticker still runs in both.
    const fullFrame = isNews || (scene.template === 'cricket' && scene.cricket.view === 'dashboard');
    const banner = this.banner.step(fullFrame && shown?.style === 'lower-third' ? null : shown, dt);
    this.bannerZone = { top: Infinity, alpha: 0 };
    if (banner) this.drawBanner(banner.value, banner.alpha, scene, now);
    // Comments clear the news lower third.
    if (isNews) this.bottomInset = Math.max(this.bottomInset, this.unit * 22);
    const comment = this.comment.step(scene.comment, dt);
    if (comment) this.drawComment(comment.value, comment.alpha, scene);

    this.drawCelebrationLayer(scene, now);

    const holding = this.holding.step(
      scene.screen === 'live'
        ? null
        : { screen: scene.screen, message: scene.screenMessage, endsAt: scene.screenEndsAt },
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

  /** What sits behind the tiles when no template is on. */
  private cleanBackdrop(scene: Scene): string | CanvasGradient {
    const color = scene.brand.color;
    switch (scene.style.backdrop) {
      case 'light':
        return '#eef2f7';
      case 'brand':
        return color;
      case 'gradient': {
        const gradient = this.ctx.createLinearGradient(0, 0, this.size.width, this.size.height);
        gradient.addColorStop(0, color);
        gradient.addColorStop(1, '#0b0c0e');
        return gradient;
      }
      case 'dark':
        return TEMPLATES.none.backdrop[0];
    }
  }

  private tilePath(tile: Tile, inset = 0): void {
    this.ctx.beginPath();
    this.ctx.roundRect(tile.x + inset, tile.y + inset, tile.width - 2 * inset, tile.height - 2 * inset, Math.max(0, tile.radius - inset));
  }

  private drawTile(tile: AnimatedTile, scene: Scene, dt: number): void {
    const { ctx, unit } = this;
    const { style } = scene;
    const isMedia = tile.id === 'media';
    const source = this.sources.get(tile.id);
    const frame = isMedia ? this.images.get(scene.media?.url) : (source?.frame ?? null);
    const label = source?.label ?? '';
    const isCam = parseSourceId(tile.id).kind === 'cam';
    const fit = isCam ? style.cameraFit : tile.fit;
    const fullBleed = tile.width >= this.size.width && tile.height >= this.size.height;

    ctx.save();
    ctx.globalAlpha *= Math.min(1, Math.max(0, tile.opacity));

    if (style.shadow && !fullBleed) {
      // A soft shadow built from a few widening, faint outlines. A real blurred shadow per tile
      // per frame costs far more than everything else in the picture.
      ctx.fillStyle = 'rgb(0 0 0 / 0.09)';
      for (let i = 1; i <= 4; i++) {
        const spread = i * unit * 0.45;
        ctx.beginPath();
        ctx.roundRect(tile.x - spread, tile.y - spread + unit * 0.9, tile.width + 2 * spread, tile.height + 2 * spread, tile.radius + spread);
        ctx.fill();
      }
    }

    ctx.save();
    this.tilePath(tile);
    ctx.clip();
    ctx.fillStyle = fit === 'contain' ? '#000000' : TILE_EMPTY;
    ctx.fillRect(tile.x, tile.y, tile.width, tile.height);

    const drawn = frame ? this.drawFrame(frame, { ...tile, fit }) : false;
    if (!drawn && !isMedia) this.drawNameCard(tile, label, scene.brand.color);
    if (scene.brand.showNames && isCam && label && tile.height > unit * 22) this.drawNameTag(tile, label, scene);
    ctx.restore();

    if (style.border !== 'none' && !fullBleed) {
      ctx.lineWidth = unit * (style.border === 'thick' ? 1 : 0.45);
      ctx.strokeStyle = style.borderColor === 'brand' ? scene.brand.color : '#ffffff';
      this.tilePath(tile, ctx.lineWidth / 2);
      ctx.stroke();
    } else if (scene.template !== 'none' && tile.radius > 0) {
      // Themed looks frame each tile faintly so it reads against the gradient.
      ctx.strokeStyle = 'rgb(255 255 255 / 0.22)';
      ctx.lineWidth = unit * 0.3;
      this.tilePath(tile);
      ctx.stroke();
    }

    const ring = this.speakingRing(tile.id, isCam && scene.auto.highlightSpeaker && !!source?.speaking, dt);
    if (ring > 0) {
      ctx.globalAlpha *= ring;
      ctx.strokeStyle = SPEAKING;
      ctx.lineWidth = unit * 0.9;
      // Inset by half the line so a full-bleed tile still shows the whole ring.
      this.tilePath(tile, ctx.lineWidth / 2);
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

  /** The participant's name on their tile, in the style and position the host chose. */
  private drawNameTag(tile: Tile, label: string, scene: Scene): void {
    const { ctx, unit } = this;
    const { nameStyle, namePosition } = scene.style;
    const color = scene.brand.color;
    const fontSize = Math.max(unit * 2.2, Math.min(unit * 3.4, tile.height * 0.075));
    const margin = fontSize * 0.6;
    const padX = fontSize * 0.7;
    const height = fontSize * 1.9;
    const top = namePosition === 'top-left';
    ctx.font = `500 ${fontSize}px ${FONT}`;
    const text = ellipsize(ctx, label, tile.width * 0.7 - padX * 2);
    const textWidth = ctx.measureText(text).width;

    const y = top ? tile.y + margin : tile.y + tile.height - height - margin;
    const centred = namePosition === 'bottom-center';
    const x = centred ? tile.x + (tile.width - textWidth - padX * 2) / 2 : tile.x + margin;

    // A banner covers the bottom-left of the frame; fade out a name tag it would sit on.
    const covered = y + height > this.bannerZone.top && x < this.size.width * 0.8;
    ctx.save();
    if (covered) ctx.globalAlpha *= 1 - this.bannerZone.alpha;
    ctx.textBaseline = 'middle';

    if (nameStyle === 'bar') {
      // A strip across the tile's edge that fades into the picture.
      const barH = height * 1.5;
      const barY = top ? tile.y : tile.y + tile.height - barH;
      const gradient = ctx.createLinearGradient(0, barY, 0, barY + barH);
      gradient.addColorStop(top ? 0 : 1, 'rgb(0 0 0 / 0.72)');
      gradient.addColorStop(top ? 1 : 0, 'rgb(0 0 0 / 0)');
      ctx.fillStyle = gradient;
      ctx.fillRect(tile.x, barY, tile.width, barH);
      ctx.fillStyle = color;
      ctx.fillRect(centred ? tile.x + tile.width / 2 - unit * 3 : tile.x + margin, top ? y + height - unit * 0.3 : y + height - unit * 0.1, unit * 6, unit * 0.5);
      ctx.fillStyle = '#ffffff';
      ctx.textAlign = centred ? 'center' : 'left';
      ctx.fillText(text, centred ? tile.x + tile.width / 2 : tile.x + margin, y + height / 2 - unit * 0.3);
    } else if (nameStyle === 'text') {
      // Bare text with a hard offset copy behind it for contrast.
      ctx.textAlign = 'left';
      ctx.font = `700 ${fontSize}px ${FONT}`;
      ctx.fillStyle = 'rgb(0 0 0 / 0.7)';
      ctx.fillText(text, x + padX * 0.2 + unit * 0.25, y + height / 2 + unit * 0.25);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(text, x + padX * 0.2, y + height / 2);
    } else {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.roundRect(x, y, textWidth + padX * 2, height, height / 2);
      ctx.fill();
      ctx.fillStyle = readableOn(color);
      ctx.textAlign = 'left';
      ctx.fillText(text, x + padX, y + height / 2 + fontSize * 0.04);
    }
    ctx.restore();
  }

  // ---------- Templates ----------

  private get painter(): Painter {
    return { ctx: this.ctx, size: this.size, unit: this.unit };
  }

  private drawBackdrop(template: TemplateId): void {
    const { ctx, size, unit } = this;
    ctx.fillStyle = this.gradient(TEMPLATES[template].backdrop);
    ctx.fillRect(0, 0, size.width, size.height);

    if (template === 'cricket') {
      // The boundary rope, very faint.
      ctx.save();
      ctx.globalAlpha *= 0.1;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = unit * 0.5;
      ctx.beginPath();
      ctx.ellipse(size.width / 2, size.height * 1.05, size.width * 0.62, size.height * 0.8, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    } else if (template === 'watchparty') {
      ctx.save();
      const base = ctx.globalAlpha;
      for (const [x, y, r, alpha] of [[0.12, 0.2, 26, 0.18], [0.88, 0.14, 18, 0.14], [0.8, 0.86, 34, 0.12], [0.2, 0.9, 16, 0.16]] as const) {
        ctx.globalAlpha = base * alpha;
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(size.width * x, size.height * y, unit * r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    } else if (template === 'newsroom') {
      // A faint globe of latitude lines behind the presenter.
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

  /** The fixed on-screen graphics of a template: channel bar, headlines, scoreboards. */
  private drawTemplateFurniture(
    template: TemplateId,
    scene: Scene,
    now: number,
    news: { headline: { text: string; alpha: number } | null; sideOccupied: boolean },
  ): void {
    const { unit } = this;
    if (template === 'newsroom') {
      drawNews(this.painter, scene, { ...news, now });
    } else if (template === 'watchparty') {
      drawPill(this.painter, unit * 3, unit * 3, 'WATCH PARTY', scene.brand.color, readableOn(scene.brand.color), now);
    } else if (template === 'cricket' && scene.cricket.view === 'dashboard') {
      drawCricketDashboard(this.painter, scene, news.sideOccupied || scene.stage.length > 0);
    } else if (template === 'cricket') {
      drawCricketStrip(this.painter, scene);
      // Banners, the ticker and comments sit above the strip.
      this.bottomInset += CRICKET_STRIP * unit;
    }
  }

  /** Plays a celebration once, starting when this client first sees its id. */
  private drawCelebrationLayer(scene: Scene, now: number): void {
    const next = scene.celebration;
    if (!next) return;
    if (next.id !== this.celebration?.id) {
      const stale = Date.now() - next.at > CELEBRATION_STALE_MS;
      this.celebration = { id: next.id, startedAt: stale ? -Infinity : now };
    }
    const elapsed = now - this.celebration.startedAt;
    if (elapsed < CELEBRATION_MS[next.kind]) drawCelebration(this.painter, next, elapsed);
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

    const padX = fontSize * 0.9;
    const maxWidth = size.width * 0.8;
    const text = ellipsize(this.ctx, banner.text, maxWidth - padX * 2);
    const width = Math.min(maxWidth, ctx.measureText(text).width + padX * 2);
    const x = unit * 4;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.roundRect(x, y, width, height, unit * 1.6);
    ctx.fill();
    ctx.fillStyle = readableOn(color);
    ctx.fillText(text, x + padX, y + height / 2 + fontSize * 0.04);
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
    const lines = wrapText(this.ctx, comment.text, width - pad * 2, 3);
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
    ctx.fillText(ellipsize(this.ctx, `${comment.author}${via}`, width - pad * 2), x + pad, y + pad);
    ctx.fillStyle = '#1f1f1f';
    ctx.font = `400 ${textSize}px ${FONT}`;
    lines.forEach((line, i) => {
      ctx.fillText(line, x + pad, y + pad + authorSize * 1.5 + i * textSize * 1.3);
    });
    ctx.restore();
  }

  /** Starting soon / Be right back / Thanks for watching: covers the whole frame. */
  private drawHoldingScreen(holding: HoldingScreen, scene: Scene, now: number): void {
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
      ctx.fillText(ellipsize(this.ctx, holding.message, size.width * 0.8), cx, y);
      y += unit * 8;
    }

    if (holding.endsAt !== null && hasCountdown(holding.screen)) {
      // Countdown: big digits, then a short line once it runs out so the screen never shows 0:00.
      const left = holding.endsAt - Date.now();
      ctx.fillStyle = '#ffffff';
      if (left > 0) {
        y += unit * 6;
        ctx.font = `700 ${unit * 15}px ${FONT}`;
        ctx.fillText(formatCountdown(left), cx, y);
      } else {
        y += unit * 2;
        ctx.font = `500 ${unit * 5}px ${FONT}`;
        ctx.fillText(holding.screen === 'starting' ? 'Starting any moment' : 'Back any moment', cx, y);
      }
      return;
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
}

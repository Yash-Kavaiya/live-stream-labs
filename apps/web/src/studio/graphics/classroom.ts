import { agendaItems, boardKey, CLASS_BOTTOM, CLASS_TOP, classMainArea, classSideColumn, slideKey, type InkStroke, type Scene } from '@studio/shared';
import { drawBoardSurface, drawInk, drawStroke, fitSurface, type Surface } from './ink';
import { drawPill, fillRound, FONT, label, readableOn, wrapText, type Painter } from './painter';

const LETTERS = ['A', 'B', 'C', 'D'];
const BOARD_INK = '#1a3d7c';
const RIGHT_ANSWER = '#1e8e3e';

export interface ClassFrame {
  /** True when sources fill the lecture's side column, so the lesson panel must not draw. */
  sideOccupied: boolean;
  /** True when anything is on stage: the board and the quiz then leave room for the camera column. */
  hasSources: boolean;
  /** The current slide's picture, once it has loaded. */
  slideImage?: HTMLImageElement | null;
  /** The stroke the host is drawing this moment, before it is saved to the scene. */
  live?: LiveInk | null;
}

/** The lesson plan and the part being taught, kept inside the plan. */
function lessonPlan(scene: Scene): { items: string[]; step: number } {
  const items = agendaItems(scene.classroom);
  return { items, step: Math.max(0, Math.min(scene.classroom.step, items.length - 1)) };
}

/** Across the top: the course, today's lesson, and which part of it this is. */
function drawHeader(p: Painter, scene: Scene, items: string[], step: number): void {
  const { ctx, size, unit } = p;
  const accent = scene.brand.color;
  const mid = (CLASS_TOP * unit) / 2;
  const course = (scene.classroom.course.trim() || 'CLASS').toUpperCase();
  const end = drawPill(p, unit * 3, mid - unit * 2.47, course, accent, readableOn(accent));

  let rightWidth = 0;
  if (items.length > 0) {
    rightWidth = label(ctx, `Part ${step + 1} of ${items.length}`, size.width - unit * 3, mid, {
      size: unit * 2.6,
      color: 'rgb(255 255 255 / 0.7)',
      align: 'right',
    });
  }
  label(ctx, scene.classroom.lesson.trim() || 'Today’s lesson', end + unit * 2, mid, {
    size: unit * 4,
    weight: 700,
    color: '#ffffff',
    maxWidth: size.width - end - unit * 8 - rightWidth,
  });
}

/** Along the bottom: every part of the lesson, the finished ones ticked and the current one lit. */
function drawPlanStrip(p: Painter, scene: Scene, items: string[], step: number): void {
  const { ctx, size, unit } = p;
  const accent = scene.brand.color;
  const height = CLASS_BOTTOM * unit;
  const top = size.height - height;
  const cy = top + height / 2;

  ctx.fillStyle = 'rgb(0 0 0 / 0.28)';
  ctx.fillRect(0, top, size.width, height);
  ctx.fillStyle = accent;
  ctx.fillRect(0, top, size.width, unit * 0.35);

  if (items.length === 0) {
    label(ctx, (scene.classroom.course.trim() || 'CLASS').toUpperCase(), unit * 3, cy, {
      size: unit * 2.4,
      weight: 700,
      color: 'rgb(255 255 255 / 0.5)',
    });
    return;
  }

  const gap = unit;
  const width = (size.width - unit * 6 - gap * (items.length - 1)) / items.length;
  const chip = unit * 5;
  items.forEach((item, i) => {
    const x = unit * 3 + i * (width + gap);
    const current = i === step;
    const done = i < step;
    fillRound(ctx, x, cy - chip / 2, width, chip, chip / 2, current ? accent : done ? 'rgb(255 255 255 / 0.16)' : 'rgb(255 255 255 / 0.07)');
    label(ctx, `${done ? '✓' : i + 1}  ${item}`, x + unit * 1.8, cy + unit * 0.1, {
      size: unit * 2.3,
      weight: current ? 700 : 500,
      color: current ? readableOn(accent) : done ? 'rgb(255 255 255 / 0.75)' : 'rgb(255 255 255 / 0.55)',
      maxWidth: width - unit * 3.6,
    });
  });
}

/** Lecture with nobody beside the teacher: the lesson plan, numbered, with the current part lit. */
function drawLessonPanel(p: Painter, scene: Scene, items: string[], step: number): void {
  const { ctx, unit } = p;
  const rect = classSideColumn(p.size);
  const accent = scene.brand.color;
  const pad = unit * 2.6;

  fillRound(ctx, rect.x, rect.y, rect.width, rect.height, unit * 1.4, 'rgb(255 255 255 / 0.07)');
  fillRound(ctx, rect.x, rect.y, rect.width, unit, [unit * 1.4, unit * 1.4, 0, 0], accent);
  label(ctx, 'TODAY’S LESSON', rect.x + pad, rect.y + unit * 5.4, { size: unit * 2.4, weight: 700, color: 'rgb(255 255 255 / 0.65)' });

  if (items.length === 0) {
    ctx.font = `700 ${unit * 5}px ${FONT}`;
    const lines = wrapText(ctx, scene.classroom.lesson.trim() || 'Welcome to class', rect.width - pad * 2, 4);
    lines.forEach((line, i) => label(ctx, line, rect.x + pad, rect.y + unit * 14 + i * unit * 6.2, { size: unit * 5, weight: 700, color: '#ffffff' }));
    return;
  }

  const radius = unit * 1.9;
  let y = rect.y + unit * 12;
  for (const [i, item] of items.entries()) {
    const current = i === step;
    const done = i < step;
    ctx.font = `${current ? 700 : 500} ${unit * 3}px ${FONT}`;
    const lines = wrapText(ctx, item, rect.width - pad * 2 - radius * 2 - unit * 1.6, 2);
    if (y + lines.length * unit * 4 > rect.y + rect.height - unit * 2) break;

    const cx = rect.x + pad + radius;
    ctx.beginPath();
    ctx.arc(cx, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = current ? accent : done ? 'rgb(255 255 255 / 0.22)' : 'rgb(255 255 255 / 0.1)';
    ctx.fill();
    label(ctx, done ? '✓' : String(i + 1), cx, y + unit * 0.1, {
      size: unit * 2.2,
      weight: 700,
      color: current ? readableOn(accent) : '#ffffff',
      align: 'center',
    });
    lines.forEach((line, n) => {
      label(ctx, line, cx + radius + unit * 1.6, y + n * unit * 4, {
        size: unit * 3,
        weight: current ? 700 : 500,
        color: current ? '#ffffff' : 'rgb(255 255 255 / 0.7)',
      });
    });
    y += lines.length * unit * 4 + unit * 2.6;
  }
}

export interface LiveInk {
  /** The surface being drawn on. */
  key: string;
  stroke: InkStroke;
  /** The points so far, as fractions of the surface. */
  points: number[];
}

/** Ink on a surface: what is saved in the scene, then the stroke the host is drawing right now. */
function drawSurfaceInk(ctx: CanvasRenderingContext2D, scene: Scene, key: string, surface: Surface, live: LiveInk | null): void {
  const ink = scene.classroom.ink;
  if (ink?.key === key) drawInk(ctx, ink.strokes, surface);
  if (live?.key === key) drawStroke(ctx, live.stroke, surface, live.points);
}

/**
 * The page of the whiteboard under the ink: the part being taught as a heading, then the typed
 * notes in marker. Sized from the surface, so the whiteboard window and the stream match exactly.
 */
export function drawBoardPage(ctx: CanvasRenderingContext2D, surface: Surface, scene: Scene): void {
  const { items, step } = lessonPlan(scene);
  const accent = scene.brand.color;
  const s = surface.width / 100;
  drawBoardSurface(ctx, surface, s * 0.6);

  const pad = s * 4;
  const inner = surface.width - pad * 2;
  const bottom = surface.y + surface.height - pad;
  // Only the first page carries the heading and notes; later pages are clean.
  if (scene.classroom.boardPage > 0) return;
  const title = items[step] ?? scene.classroom.lesson.trim();
  let y = surface.y + pad + s * 1.2;
  if (title) {
    label(ctx, title, surface.x + pad, y, { size: s * 3.4, weight: 700, color: '#202124', maxWidth: inner });
    fillRound(ctx, surface.x + pad, y + s * 2.6, s * 9, s * 0.55, s * 0.27, accent);
    y += s * 7;
  }

  const size = s * 2.6;
  const lineHeight = size * 1.35;
  for (const raw of scene.classroom.board.split('\n')) {
    const line = raw.trim();
    if (!line) {
      y += lineHeight * 0.5;
      continue;
    }
    const bullet = /^[-•*]\s+/.test(line);
    const text = bullet ? line.replace(/^[-•*]\s+/, '') : line;
    const indent = bullet ? s * 2.4 : 0;
    ctx.font = `500 ${size}px ${FONT}`;
    const wrapped = wrapText(ctx, text, inner - indent, 3);
    if (y + lineHeight * (wrapped.length - 1) > bottom) break;
    if (bullet) {
      ctx.fillStyle = accent;
      ctx.beginPath();
      ctx.arc(surface.x + pad + s * 0.75, y, s * 0.55, 0, Math.PI * 2);
      ctx.fill();
    }
    wrapped.forEach((part, i) => label(ctx, part, surface.x + pad + indent, y + i * lineHeight, { size, weight: 500, color: BOARD_INK }));
    y += wrapped.length * lineHeight + s * 0.6;
  }
}

/** The whiteboard in a frame with a marker tray, the page on it, and the ink. */
function drawBoard(p: Painter, scene: Scene, frame: ClassFrame): void {
  const { ctx, unit } = p;
  const area = classMainArea(p.size, frame.hasSources);
  const rim = unit * 1.1;
  const surface = fitSurface({ x: area.x + rim, y: area.y + rim, width: area.width - rim * 2, height: area.height - rim * 3.2 });
  const outer = { x: surface.x - rim, y: surface.y - rim, width: surface.width + rim * 2, height: surface.height + rim * 3.2 };

  fillRound(ctx, outer.x, outer.y, outer.width, outer.height, unit * 1.4, '#c9ced5');
  // The marker tray, with three pens on it.
  const trayY = surface.y + surface.height + rim * 0.6;
  fillRound(ctx, outer.x + outer.width * 0.58, trayY, outer.width * 0.34, rim * 1.1, unit * 0.4, '#a9b0b8');
  for (const [i, pen] of ['#d93025', BOARD_INK, '#188038'].entries()) {
    fillRound(ctx, outer.x + outer.width * 0.61 + i * unit * 7, trayY - unit * 0.8, unit * 5.5, unit * 1.1, unit * 0.5, pen);
  }

  drawBoardPage(ctx, surface, scene);
  ctx.save();
  ctx.beginPath();
  ctx.roundRect(surface.x, surface.y, surface.width, surface.height, unit * 0.6);
  ctx.clip();
  drawSurfaceInk(ctx, scene, boardKey(scene.classroom.boardPage), surface, frame.live ?? null);
  ctx.restore();

  if (scene.classroom.boardPages > 1) {
    const text = `${scene.classroom.boardPage + 1} / ${scene.classroom.boardPages}`;
    label(ctx, text, surface.x + surface.width - unit * 1.6, surface.y + surface.height - unit * 2, {
      size: unit * 2,
      weight: 600,
      color: 'rgb(32 33 36 / 0.45)',
      align: 'right',
    });
  }
}

/** The current slide, letterboxed on black, with the ink written on it and a slide counter. */
function drawSlides(p: Painter, scene: Scene, frame: ClassFrame): void {
  const { ctx, unit } = p;
  const { slides } = scene.classroom;
  const index = Math.min(scene.classroom.slide, slides.length - 1);
  const surface = fitSurface(classMainArea(p.size, frame.hasSources));
  const radius = unit * 1.4;

  ctx.save();
  ctx.beginPath();
  ctx.roundRect(surface.x, surface.y, surface.width, surface.height, radius);
  ctx.clip();
  ctx.fillStyle = '#000000';
  ctx.fillRect(surface.x, surface.y, surface.width, surface.height);
  const image = frame.slideImage;
  if (image && image.naturalWidth > 0) {
    const scale = Math.min(surface.width / image.naturalWidth, surface.height / image.naturalHeight);
    const w = image.naturalWidth * scale;
    const h = image.naturalHeight * scale;
    ctx.drawImage(image, surface.x + (surface.width - w) / 2, surface.y + (surface.height - h) / 2, w, h);
  } else {
    label(ctx, 'Loading slide…', surface.x + surface.width / 2, surface.y + surface.height / 2, { size: unit * 3, color: 'rgb(255 255 255 / 0.5)', align: 'center' });
  }
  drawSurfaceInk(ctx, scene, slideKey(index), surface, frame.live ?? null);
  ctx.restore();

  const text = `${index + 1} / ${slides.length}`;
  ctx.font = `600 ${unit * 2}px ${FONT}`;
  const width = ctx.measureText(text).width + unit * 2.4;
  fillRound(ctx, surface.x + surface.width - width - unit * 1.2, surface.y + surface.height - unit * 4.4, width, unit * 3.2, unit * 1.6, 'rgb(0 0 0 / 0.55)');
  label(ctx, text, surface.x + surface.width - width / 2 - unit * 1.2, surface.y + surface.height - unit * 2.8, { size: unit * 2, weight: 600, color: '#ffffff', align: 'center' });
}

/** A question and its options in a two-by-two grid; once revealed, the right one turns green. */
function drawQuiz(p: Painter, scene: Scene, hasSources: boolean): void {
  const { ctx, unit } = p;
  const area = classMainArea(p.size, hasSources);
  const accent = scene.brand.color;
  const { question, options, answer, revealed } = scene.classroom.quiz;
  const pad = unit * 3;

  fillRound(ctx, area.x, area.y, area.width, area.height, unit * 1.4, 'rgb(255 255 255 / 0.07)');
  drawPill(p, area.x + pad, area.y + pad, revealed && answer !== null ? 'ANSWER' : 'QUIZ', accent, readableOn(accent));

  let y = area.y + pad + unit * 11;
  if (!question.trim()) {
    label(ctx, 'Add a question on the Class tab', area.x + pad, y, { size: unit * 4, weight: 500, color: 'rgb(255 255 255 / 0.55)' });
    return;
  }
  ctx.font = `700 ${unit * 5}px ${FONT}`;
  const lines = wrapText(ctx, question.trim(), area.width - pad * 2, 3);
  lines.forEach((line, i) => label(ctx, line, area.x + pad, y + i * unit * 6.2, { size: unit * 5, weight: 700, color: '#ffffff' }));
  y += lines.length * unit * 6.2 + unit;

  const shown = options.map((text, index) => ({ text: text.trim(), index })).filter((o) => o.text);
  if (shown.length === 0) return;
  const gap = unit * 2;
  const rows = Math.ceil(shown.length / 2);
  const cellWidth = (area.width - pad * 2 - gap) / 2;
  const cellHeight = Math.min(unit * 13, (area.y + area.height - pad - y - gap * (rows - 1)) / rows);
  if (cellHeight < unit * 5) return;

  shown.forEach((option, i) => {
    const x = area.x + pad + (i % 2) * (cellWidth + gap);
    const top = y + Math.floor(i / 2) * (cellHeight + gap);
    const right = revealed && option.index === answer;
    const faded = revealed && answer !== null && !right;

    ctx.save();
    if (faded) ctx.globalAlpha *= 0.45;
    fillRound(ctx, x, top, cellWidth, cellHeight, unit * 1.2, right ? RIGHT_ANSWER : 'rgb(255 255 255 / 0.12)');
    const radius = Math.min(cellHeight * 0.3, unit * 3);
    const cx = x + unit * 2 + radius;
    const cy = top + cellHeight / 2;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = right ? '#ffffff' : accent;
    ctx.fill();
    label(ctx, right ? '✓' : LETTERS[option.index]!, cx, cy + unit * 0.1, {
      size: radius * 1.1,
      weight: 700,
      color: right ? RIGHT_ANSWER : readableOn(accent),
      align: 'center',
    });
    const textX = cx + radius + unit * 1.8;
    const textSize = unit * 3.4;
    ctx.font = `600 ${textSize}px ${FONT}`;
    const wrapped = wrapText(ctx, option.text, x + cellWidth - unit * 2 - textX, 2);
    const first = cy - ((wrapped.length - 1) * textSize * 1.25) / 2;
    wrapped.forEach((part, n) => label(ctx, part, textX, first + n * textSize * 1.25, { size: textSize, weight: 600, color: '#ffffff' }));
    ctx.restore();
  });
}

/** Everything a classroom scene draws on top of the video. */
export function drawClassroom(p: Painter, scene: Scene, frame: ClassFrame): void {
  const { items, step } = lessonPlan(scene);
  drawHeader(p, scene, items, step);
  switch (scene.classroom.view) {
    case 'lecture':
      if (!frame.sideOccupied) drawLessonPanel(p, scene, items, step);
      break;
    case 'board':
      drawBoard(p, scene, frame);
      break;
    case 'quiz':
      drawQuiz(p, scene, frame.hasSources);
      break;
    case 'slides':
      if (scene.classroom.slides.length > 0) drawSlides(p, scene, frame);
      break;
  }
  drawPlanStrip(p, scene, items, step);
}

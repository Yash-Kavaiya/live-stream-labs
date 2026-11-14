import { expect, test, type Page } from '@playwright/test';

const field = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

/** A small 16:9 PDF, one big title per page, with a correct cross-reference table. */
function makePdf(titles: string[]): Buffer {
  const objects: string[] = [];
  const pageIds = titles.map((_, i) => 4 + i * 2);
  objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
  objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${titles.length} >>`;
  objects[3] = '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>';
  titles.forEach((title, i) => {
    const stream = `0.1 0.3 0.7 rg 0 440 960 100 re f BT /F1 72 Tf 80 250 Td 0 0 0 rg (${title}) Tj ET`;
    objects[pageIds[i]!] = `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 960 540] /Resources << /Font << /F1 3 0 R >> >> /Contents ${pageIds[i]! + 1} 0 R >>`;
    objects[pageIds[i]! + 1] = `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
  });
  let out = '%PDF-1.4\n';
  const offsets: number[] = [];
  for (let id = 1; id < objects.length; id++) {
    offsets[id] = out.length;
    out += `${id} 0 obj\n${objects[id]}\nendobj\n`;
  }
  const xref = out.length;
  out += `xref\n0 ${objects.length}\n0000000000 65535 f \n`;
  for (let id = 1; id < objects.length; id++) out += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`;
  out += `trailer\n<< /Size ${objects.length} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, 'latin1');
}

/** Drags across the drawing surface, in fractions of its size. */
async function draw(win: Page, points: [number, number][]) {
  const box = (await win.getByTestId('ink-canvas').boundingBox())!;
  const at = ([x, y]: [number, number]) => [box.x + x * box.width, box.y + y * box.height] as const;
  await win.mouse.move(...at(points[0]!));
  await win.mouse.down();
  for (const p of points.slice(1)) await win.mouse.move(...at(p), { steps: 8 });
  await win.mouse.up();
}

test('whiteboard and slides windows draw on the stream', async ({ page, context }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  await page.goto('/signup');
  await field(page, 'name').fill('Tara Teacher');
  await field(page, 'email').fill(`teacher-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/app$/);
  const broadcast = await (await page.request.post('/api/broadcasts', { data: { title: 'Physics' } })).json();
  const saved = async () => (await (await page.request.post(`/api/broadcasts/${broadcast.id}/session`)).json()).scene.classroom;
  const program = (name: string) => page.getByTestId('program-canvas').screenshot({ path: `test-results/screens/class-${name}.png` });

  await page.goto(`/studio/${broadcast.id}`);
  await page.getByTestId('enter-studio').click();
  await page.getByTestId('source-cam').waitFor();
  await page.getByTestId('template-classroom').click();
  await page.getByTestId('tab-template').click();
  await field(page, 'class-notes').fill('- Force = mass × acceleration\n- Units: newtons');

  // --- Whiteboard window ---
  const [board] = await Promise.all([context.waitForEvent('page'), page.getByTestId('open-board').click()]);
  await board.getByTestId('board-window').waitFor();
  await board.getByTestId('board-show').click();
  await expect(board.getByTestId('board-on-air')).toBeVisible();

  // A wavy pen line, a red arrow, a rectangle and some text.
  await draw(board, [[0.1, 0.6], [0.2, 0.5], [0.3, 0.65], [0.4, 0.5], [0.5, 0.62]]);
  await board.getByTestId('ink-tool-arrow').click();
  await board.getByTestId('ink-color-3').click();
  await draw(board, [[0.55, 0.75], [0.8, 0.55]]);
  await board.getByTestId('ink-tool-rect').click();
  await board.getByTestId('ink-color-2').click();
  await draw(board, [[0.62, 0.3], [0.9, 0.48]]);
  await board.getByTestId('ink-tool-text').click();
  const surface = (await board.getByTestId('ink-canvas').boundingBox())!;
  await board.mouse.click(surface.x + surface.width * 0.64, surface.y + surface.height * 0.34);
  await board.getByTestId('ink-text').fill('F = m·a');
  await board.getByTestId('ink-text').press('Enter');
  await expect(board.getByTestId('ink-canvas')).toHaveAttribute('data-strokes', '4');
  await board.screenshot({ path: 'test-results/screens/class-board-window.png' });

  // The stream shows the board, and the scene carries its ink.
  await expect.poll(async () => (await saved()).ink?.strokes.length).toBe(4);
  expect((await saved()).view).toBe('board');
  await program('board');

  // Undo, the eraser, and a second page.
  await board.getByTestId('ink-undo').click();
  await expect(board.getByTestId('ink-canvas')).toHaveAttribute('data-strokes', '3');
  await board.getByTestId('ink-redo').click();
  await expect(board.getByTestId('ink-canvas')).toHaveAttribute('data-strokes', '4');
  await board.getByTestId('ink-tool-eraser').click();
  await draw(board, [[0.3, 0.45], [0.3, 0.7]]);
  await expect(board.getByTestId('ink-canvas')).toHaveAttribute('data-strokes', '3');
  await board.getByTestId('board-add-page').click();
  await expect(board.getByTestId('board-page')).toHaveText('Page 2 of 2');
  await expect(board.getByTestId('ink-canvas')).toHaveAttribute('data-strokes', '0');
  await expect.poll(async () => (await saved()).ink).toBeNull();
  await board.getByTestId('board-prev').click();
  await expect(board.getByTestId('ink-canvas')).toHaveAttribute('data-strokes', '3');
  await expect.poll(async () => (await saved()).ink?.key).toBe('board:0');

  // --- Slides window ---
  const [slides] = await Promise.all([context.waitForEvent('page'), page.getByTestId('open-slides').click()]);
  await slides.getByTestId('slides-window').waitFor();
  await slides.getByTestId('slides-file').setInputFiles({
    name: 'lesson.pdf',
    mimeType: 'application/pdf',
    buffer: makePdf(["Newton's laws", 'First law: inertia', 'Second law: F = ma']),
  });
  await expect(slides.getByTestId('slides-thumb')).toHaveCount(3, { timeout: 30_000 });
  await expect(slides.getByTestId('slides-index')).toHaveText('1 / 3');
  await expect(slides.getByTestId('slides-on-air')).toBeVisible();
  await expect.poll(async () => (await saved()).slides.length).toBe(3);

  // Arrow keys step through; ink stays on its own slide.
  await slides.keyboard.press('ArrowRight');
  await expect(slides.getByTestId('slides-index')).toHaveText('2 / 3');
  await draw(slides, [[0.1, 0.62], [0.5, 0.62]]);
  await expect.poll(async () => (await saved()).ink?.key).toBe('slide:1');
  await slides.screenshot({ path: 'test-results/screens/class-slides-window.png' });
  await program('slides');
  await slides.keyboard.press('ArrowRight');
  await expect(slides.getByTestId('slides-index')).toHaveText('3 / 3');
  await expect(slides.getByTestId('ink-canvas')).toHaveAttribute('data-strokes', '0');
  await slides.getByTestId('slides-thumb').nth(1).click();
  await expect(slides.getByTestId('ink-canvas')).toHaveAttribute('data-strokes', '1');

  // The Class tab steps slides too.
  await expect(page.getByTestId('class-slide')).toHaveText('Slide 2 of 3');
});

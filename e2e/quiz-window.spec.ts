import { expect, test, type Page } from '@playwright/test';

const field = (page: Page, id: string) => page.getByTestId(id).locator('input, textarea').first();

const TRANSCRIPT =
  'Today we look at photosynthesis. Plants take in carbon dioxide through tiny holes called stomata and water through the roots. ' +
  'Chlorophyll in the chloroplasts captures sunlight, and the plant makes glucose and releases oxygen.';

// What the AI would send back; the real model is not called in tests.
const QUESTIONS = [
  { question: 'What do stomata let into the leaf?', options: ['Nitrogen', 'Carbon dioxide', 'Glucose', 'Chlorophyll'], answer: 1, revealed: false },
  { question: 'Which pigment captures sunlight?', options: ['Chlorophyll', 'Melanin', 'Keratin', 'Hemoglobin'], answer: 0, revealed: false },
  { question: 'What gas do plants release?', options: ['Methane', 'Carbon dioxide', 'Helium', 'Oxygen'], answer: 3, revealed: false },
];

test('quiz window writes questions from a transcript and runs them on air', async ({ page, context }) => {
  test.setTimeout(120_000);
  const stamp = Date.now();
  await page.goto('/signup');
  await field(page, 'name').fill('Quinn Quizmaster');
  await field(page, 'email').fill(`quiz-${stamp}@example.com`);
  await field(page, 'password').fill('correct horse battery');
  await page.getByTestId('submit').click();
  await page.waitForURL(/\/app$/);
  const broadcast = await (await page.request.post('/api/broadcasts', { data: { title: 'Biology' } })).json();
  const saved = async () => (await (await page.request.post(`/api/broadcasts/${broadcast.id}/session`)).json()).scene;

  const asked: { transcript: string; count: number; level: string }[] = [];
  await context.route(`**/api/broadcasts/${broadcast.id}/quiz`, async (route) => {
    asked.push(route.request().postDataJSON());
    await route.fulfill({ json: { questions: QUESTIONS, model: 'test-model' } });
  });

  await page.goto(`/studio/${broadcast.id}`);
  await page.getByTestId('enter-studio').click();
  await page.getByTestId('source-cam').waitFor();
  await page.getByTestId('template-classroom').click();
  await page.getByTestId('tab-template').click();

  const [quiz] = await Promise.all([context.waitForEvent('page'), page.getByTestId('open-quiz').click()]);
  await quiz.getByTestId('quiz-window').waitFor();
  await expect(quiz.getByTestId('quiz-generate')).toHaveAttribute('disabled', '');

  await quiz.getByTestId('quiz-transcript').fill(TRANSCRIPT);
  await expect(quiz.getByTestId('quiz-words')).toHaveText(/3\d words/);
  await quiz.getByRole('button', { name: '3', exact: true }).click();
  await quiz.getByRole('button', { name: 'Hard' }).click();
  await quiz.getByTestId('quiz-generate').click();
  await expect(quiz.getByTestId('quiz-card')).toHaveCount(3);
  await expect(quiz.getByTestId('quiz-message')).toContainText('written by test-model');
  expect(asked[0]).toMatchObject({ transcript: TRANSCRIPT, count: 3, level: 'hard' });
  await expect.poll(async () => (await saved()).classroom.quizBank.length).toBe(3);

  // Fix the wording of the first question, then put it on air.
  const first = quiz.getByTestId('quiz-card').first();
  await first.getByRole('textbox', { name: 'Question 1' }).fill('What enters the leaf through the stomata?');
  await first.getByTestId('quiz-show').click();
  await expect(quiz.getByTestId('quiz-live')).toHaveText('What enters the leaf through the stomata?');
  await expect.poll(async () => (await saved()).classroom).toMatchObject({
    view: 'quiz',
    quizPick: 0,
    quiz: { question: 'What enters the leaf through the stomata?', answer: 1, revealed: false },
  });
  await quiz.screenshot({ path: 'test-results/screens/quiz-window.png' });

  await quiz.getByTestId('quiz-reveal-window').click();
  await expect.poll(async () => (await saved()).classroom.quiz.revealed).toBe(true);
  await page.waitForTimeout(400);
  await page.getByTestId('program-canvas').screenshot({ path: 'test-results/screens/quiz-revealed.png' });

  await quiz.getByTestId('quiz-next').click();
  await expect(quiz.getByTestId('quiz-live')).toHaveText('Which pigment captures sunlight?');
  await expect.poll(async () => (await saved()).classroom).toMatchObject({ quizPick: 1, quiz: { revealed: false } });

  // The transcript survives closing and reopening the window.
  await quiz.close();
  const [again] = await Promise.all([context.waitForEvent('page'), page.getByTestId('open-quiz').click()]);
  await expect(again.getByTestId('quiz-transcript')).toHaveValue(TRANSCRIPT);
  await expect(again.getByTestId('quiz-card')).toHaveCount(3);
});

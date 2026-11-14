import { describe, expect, it } from 'vitest';
import type { Provider } from '../news/writer';
import { createTestApp, TestClient } from '../testing';
import { buildQuizPrompt, createQuizWriter, readQuestions, shuffleOptions } from './writer';

const TRANSCRIPT =
  'today we are looking at newtons laws of motion the first law says an object keeps moving at the same speed ' +
  'unless a force acts on it that is inertia the second law says force equals mass times acceleration';

const good = (answer: number) => ({ question: `Which law is about inertia? ${answer}`, options: ['First law', 'Second law', 'Third law', 'Hooke'], answer });

describe('quiz questions from a model', () => {
  it('keeps well-formed questions and drops the rest', () => {
    const questions = readQuestions(
      {
        questions: [
          good(0),
          { question: 'Too few options', options: ['a', 'b'], answer: 0 },
          { question: 'Answer out of range', options: ['a', 'b', 'c', 'd'], answer: 4 },
          { question: 'Repeated options', options: ['a', 'a', 'c', 'd'], answer: 1 },
          good(0),
          { question: '  What does F   equal? ', options: ['m × a', 'm / a', 'm + a', 'a / m'], answer: '0' },
        ],
      },
      5,
    );
    expect(questions).toEqual([
      { question: 'Which law is about inertia? 0', options: ['First law', 'Second law', 'Third law', 'Hooke'], answer: 0, revealed: false },
      { question: 'What does F equal?', options: ['m × a', 'm / a', 'm + a', 'a / m'], answer: 0, revealed: false },
    ]);
  });

  it('stops at the number asked for', () => {
    const list = [0, 1, 2, 3].map((i) => ({ ...good(i), question: `Q${i}` }));
    expect(readQuestions({ questions: list }, 2)).toHaveLength(2);
  });

  it('puts the latest part of a long transcript in the prompt', () => {
    const long = `${'old words '.repeat(5000)}THE END`;
    const { user, system } = buildQuizPrompt({ transcript: long, count: 3, level: 'hard' });
    expect(user).toContain('THE END');
    expect(user.length).toBeLessThan(25_000);
    expect(user).toContain('Write 3 questions');
    expect(system).toContain('JSON');
  });

  it('falls back to the next model when one fails', async () => {
    const broken: Provider = { name: 'broken', generate: async () => 'no json here' };
    const working: Provider = { name: 'working', generate: async () => JSON.stringify({ questions: [good(2)] }) };
    const result = await createQuizWriter([broken, working]).write({ transcript: TRANSCRIPT, count: 1, level: 'easy' });
    expect(result.model).toBe('working');
    const [q] = result.questions;
    expect(q!.options[q!.answer!]).toBe('Third law');
  });

  it('moves the right answer around but keeps it right', () => {
    const quiz = { question: 'Q', options: ['right', 'b', 'c', 'd'], answer: 0, revealed: false };
    const spots = new Set<number>();
    for (let seed = 0; seed < 40; seed++) {
      let n = seed;
      const shuffled = shuffleOptions(quiz, () => ((n = (n * 9301 + 49297) % 233280) / 233280));
      expect(shuffled.options[shuffled.answer!]).toBe('right');
      expect([...shuffled.options].sort()).toEqual(['b', 'c', 'd', 'right']);
      spots.add(shuffled.answer!);
    }
    expect(spots.size).toBe(4);
  });
});

describe('POST /api/broadcasts/:id/quiz', () => {
  it('writes questions for the owner only', async () => {
    const calls: string[] = [];
    const provider: Provider = {
      name: 'fake-model',
      generate: async (_system, user) => {
        calls.push(user);
        return JSON.stringify({ questions: [good(1)] });
      },
    };
    const t = await createTestApp({ quiz: createQuizWriter([provider]) });
    const host = new TestClient(t.app);
    await host.call('POST', '/api/auth/signup', { name: 'Tara', email: 'tara@example.com', password: 'correct horse battery' });
    const broadcast = (await host.call('POST', '/api/broadcasts', { title: 'Physics' })).body;

    const ok = await host.call('POST', `/api/broadcasts/${broadcast.id}/quiz`, { transcript: TRANSCRIPT, count: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body).toMatchObject({ model: 'fake-model', questions: [{ revealed: false }] });
    expect(ok.body.questions[0].options[ok.body.questions[0].answer]).toBe('Second law');
    expect(calls[0]).toContain('inertia');

    expect((await host.call('POST', `/api/broadcasts/${broadcast.id}/quiz`, { transcript: 'too short' })).status).toBe(400);
    expect((await new TestClient(t.app).call('POST', `/api/broadcasts/${broadcast.id}/quiz`, { transcript: TRANSCRIPT })).status).toBe(401);
    await t.close();
  });

  it('says how to set up a model when none is configured', async () => {
    const bare = await createTestApp();
    const owner = new TestClient(bare.app);
    await owner.call('POST', '/api/auth/signup', { name: 'Tara', email: 'tara@example.com', password: 'correct horse battery' });
    const other = (await owner.call('POST', '/api/broadcasts', { title: 'Physics' })).body;
    const none = await owner.call('POST', `/api/broadcasts/${other.id}/quiz`, { transcript: TRANSCRIPT });
    expect(none.status).toBe(503);
    expect(none.body.message).toContain('GEMINI_API_KEY');
    await bare.close();
  });
});

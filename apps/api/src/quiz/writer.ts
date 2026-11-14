import { QUIZ_OPTIONS, type GeneratedQuiz, type Quiz } from '@studio/shared';
import { extractJson, reasonOf, type Provider } from '../news/writer';

/**
 * Writes multiple-choice questions about what was said in a class, from its transcript. The
 * models get the words as spoken (captions have no punctuation and mishear names), so the prompt
 * asks them to quiz the ideas, not the wording.
 */

export interface QuizRequest {
  transcript: string;
  count: number;
  level: 'easy' | 'mixed' | 'hard';
}

export interface QuizWriter {
  write(request: QuizRequest): Promise<GeneratedQuiz>;
}

export class NoModelError extends Error {}

/** The most transcript a model is shown: the latest part of a long class. */
const MAX_TRANSCRIPT = 24_000;

const LEVELS: Record<QuizRequest['level'], string> = {
  easy: 'Easy: check that students remember the main facts and terms.',
  mixed: 'Mixed: start with recall, then ask about understanding and applying the ideas.',
  hard: 'Hard: ask students to apply, compare or reason about the ideas, not just recall them.',
};

export function buildQuizPrompt({ transcript, count, level }: QuizRequest): { system: string; user: string } {
  const system = [
    'You write multiple-choice quiz questions for a live online class, from a transcript of what the teacher said.',
    'The transcript comes from automatic captions: it may lack punctuation and contain misheard words. Quiz the ideas that were taught, and fix obvious mishearings.',
    'Rules for every question:',
    '- Only ask about what the transcript teaches. Never use outside facts the teacher did not cover.',
    `- Exactly ${QUIZ_OPTIONS} options, all different, all plausible, only one right.`,
    '- The question is at most 150 characters; each option at most 55. Plain text, no numbering, no letters like "A)".',
    '- No "all of the above", "none of the above", or trick wording.',
    '- Spread the right answer across the four positions.',
    'Answer with JSON only: {"questions":[{"question":"...","options":["...","...","...","..."],"answer":0}]}, where answer is the index (0-3) of the right option.',
  ].join('\n');
  const words = transcript.length > MAX_TRANSCRIPT ? `…${transcript.slice(-MAX_TRANSCRIPT)}` : transcript;
  const user = `Write ${count} question${count === 1 ? '' : 's'}. Level: ${LEVELS[level]}\n\nTranscript:\n"""\n${words}\n"""`;
  return { system, user };
}

const clip = (text: unknown, max: number) => (typeof text === 'string' ? text.replace(/\s+/g, ' ').trim().slice(0, max) : '');

/** The usable questions in a model's answer; anything malformed is dropped, not fixed up. */
export function readQuestions(answer: unknown, count: number): Quiz[] {
  const list = (answer as { questions?: unknown })?.questions;
  if (!Array.isArray(list)) throw new Error('The model did not return a list of questions');
  const seen = new Set<string>();
  const out: Quiz[] = [];
  for (const item of list) {
    const raw = item as { question?: unknown; options?: unknown; answer?: unknown };
    const question = clip(raw.question, 160);
    const options = Array.isArray(raw.options) ? raw.options.map((o) => clip(o, 60)) : [];
    const answerIndex = typeof raw.answer === 'number' ? raw.answer : Number(raw.answer);
    const valid =
      question.length > 0 &&
      options.length === QUIZ_OPTIONS &&
      options.every(Boolean) &&
      new Set(options.map((o) => o.toLowerCase())).size === QUIZ_OPTIONS &&
      Number.isInteger(answerIndex) &&
      answerIndex >= 0 &&
      answerIndex < QUIZ_OPTIONS &&
      !seen.has(question.toLowerCase());
    if (!valid) continue;
    seen.add(question.toLowerCase());
    out.push({ question, options, answer: answerIndex, revealed: false });
    if (out.length >= count) break;
  }
  if (out.length === 0) throw new Error('The model wrote no usable questions');
  return out;
}

/**
 * Shuffles a question's options. Models put the right answer first far too often, which a class
 * catches on to within a couple of questions, so the order is not left to them.
 */
export function shuffleOptions(quiz: Quiz, random: () => number = Math.random): Quiz {
  const order = quiz.options.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [order[i], order[j]] = [order[j]!, order[i]!];
  }
  return { ...quiz, options: order.map((i) => quiz.options[i]!), answer: quiz.answer === null ? null : order.indexOf(quiz.answer) };
}

/** Tries each model in turn until one writes usable questions. */
export function createQuizWriter(providers: Provider[], random: () => number = Math.random): QuizWriter {
  return {
    async write(request) {
      if (providers.length === 0) throw new NoModelError('No AI model key is set. Add GEMINI_API_KEY or NVIDIA_API_KEY to .env.');
      const { system, user } = buildQuizPrompt(request);
      const problems: string[] = [];
      for (const provider of providers) {
        try {
          const questions = readQuestions(extractJson(await provider.generate(system, user)), request.count).map((q) => shuffleOptions(q, random));
          return { questions, model: provider.name };
        } catch (err) {
          problems.push(`${provider.name}: ${reasonOf(err)}`);
        }
      }
      throw new Error(`Could not write questions. ${problems.join('; ')}`);
    },
  };
}

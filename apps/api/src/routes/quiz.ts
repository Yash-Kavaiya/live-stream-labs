import { generateQuizSchema, type GeneratedQuiz } from '@studio/shared';
import type { FastifyInstance } from 'fastify';
import { HttpError, parse, requireUserId, type Deps } from '../http/context';
import { NoModelError } from '../quiz/writer';
import { getOwnedBroadcast } from '../services/broadcasts';

export function quizRoutes(app: FastifyInstance, deps: Deps): void {
  // The host asks the AI for questions about what has been said in class so far.
  app.post('/api/broadcasts/:id/quiz', async (req): Promise<GeneratedQuiz> => {
    const userId = await requireUserId(deps, req);
    await getOwnedBroadcast(deps, userId, (req.params as { id: string }).id);
    const input = parse(generateQuizSchema, req.body);
    try {
      return await deps.quiz.write(input);
    } catch (err) {
      if (err instanceof NoModelError) throw new HttpError(503, 'no_model', err.message);
      req.log.warn({ err }, 'quiz generation failed');
      throw new HttpError(502, 'quiz_failed', err instanceof Error ? err.message : 'Could not write questions');
    }
  });
}

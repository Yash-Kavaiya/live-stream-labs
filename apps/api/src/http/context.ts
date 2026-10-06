import type { FastifyReply, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import type { Config } from '../config';
import type { SecretBox, TokenSigner } from '../crypto';
import type { Db } from '../db/client';
import type { AdapterResolver } from '../destinations/adapters';
import type { Fetch } from '../destinations/types';
import type { EgressProvider } from '../egress/providers';
import type { RundownService } from '../news/service';
import type { LiveKitGateway } from '../services/livekit';

/** Everything a route needs. Built once in `index.ts`; tests pass fakes. */
export interface Deps {
  config: Config;
  db: Db;
  box: SecretBox;
  signer: TokenSigner;
  livekit: LiveKitGateway;
  egress: EgressProvider;
  adapterFor: AdapterResolver;
  fetch: Fetch;
  rundowns: RundownService;
}

export class HttpError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export const notFound = (what: string) => new HttpError(404, 'not_found', `${what} not found`);
export const badRequest = (message: string) => new HttpError(400, 'bad_request', message);

export function parse<S extends z.ZodType>(schema: S, data: unknown): z.output<S> {
  const result = schema.safeParse(data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  const where = issue?.path.length ? `${issue.path.join('.')}: ` : '';
  throw badRequest(`${where}${issue?.message ?? 'Invalid input'}`);
}

const SESSION_COOKIE = 'sid';
const SESSION_DAYS = 30;

export async function startSession(deps: Deps, reply: FastifyReply, userId: string): Promise<void> {
  const token = await deps.signer.sign('session', { sub: userId }, `${SESSION_DAYS}d`);
  reply.setCookie(SESSION_COOKIE, token, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    secure: deps.config.env === 'production',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function endSession(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export async function optionalUserId(deps: Deps, req: FastifyRequest): Promise<string | null> {
  const token = req.cookies[SESSION_COOKIE];
  if (!token) return null;
  const claims = await deps.signer.verify('session', token);
  return claims?.sub ?? null;
}

export async function requireUserId(deps: Deps, req: FastifyRequest): Promise<string> {
  const userId = await optionalUserId(deps, req);
  if (!userId) throw new HttpError(401, 'unauthenticated', 'Sign in to continue');
  return userId;
}

import { loginSchema, signupSchema, type ServerConfigDto, type UserDto } from '@studio/shared';
import { eq, or } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { hashPassword, newId, verifyPassword } from '../crypto';
import { users, type UserRow } from '../db/schema';
import { authorizeUrl, exchangeCode, fetchAccount, oauthProvider } from '../destinations/oauth';
import {
  endSession,
  HttpError,
  notFound,
  optionalUserId,
  parse,
  startSession,
  type Deps,
} from '../http/context';

const toUserDto = (u: UserRow): UserDto => ({ id: u.id, name: u.name, email: u.email });

export function authRoutes(app: FastifyInstance, deps: Deps): void {
  const { db, config } = deps;
  const googleRedirect = `${config.webOrigin}/api/auth/google/callback`;

  app.get('/api/config', async (): Promise<ServerConfigDto> => {
    const has = (id: 'google' | 'youtube' | 'twitch' | 'facebook') => !!oauthProvider(config, id);
    return {
      oauth: {
        google: has('google'),
        youtube: has('youtube'),
        twitch: has('twitch'),
        facebook: has('facebook'),
      },
      egressMode: deps.egress.mode,
    };
  });

  app.post('/api/auth/signup', async (req, reply) => {
    const input = parse(signupSchema, req.body);
    const [existing] = await db.select().from(users).where(eq(users.email, input.email));
    if (existing) throw new HttpError(409, 'email_taken', 'An account with this email already exists');

    const [user] = await db
      .insert(users)
      .values({
        id: newId(),
        email: input.email,
        name: input.name,
        passwordHash: await hashPassword(input.password),
      })
      .returning();
    await startSession(deps, reply, user!.id);
    return toUserDto(user!);
  });

  app.post('/api/auth/login', async (req, reply) => {
    const input = parse(loginSchema, req.body);
    const [user] = await db.select().from(users).where(eq(users.email, input.email));
    const ok = user?.passwordHash && (await verifyPassword(input.password, user.passwordHash));
    if (!user || !ok) throw new HttpError(401, 'bad_credentials', 'Wrong email or password');
    await startSession(deps, reply, user.id);
    return toUserDto(user);
  });

  app.post('/api/auth/logout', async (_req, reply) => {
    endSession(reply);
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const userId = await optionalUserId(deps, req);
    if (!userId) return { user: null };
    const [user] = await db.select().from(users).where(eq(users.id, userId));
    return { user: user ? toUserDto(user) : null };
  });

  app.get('/api/auth/google/start', async (_req, reply) => {
    const provider = oauthProvider(config, 'google');
    if (!provider) throw notFound('Google sign-in');
    const state = await deps.signer.sign('oauth-state', { p: 'google' }, '10m');
    return reply.redirect(authorizeUrl(provider, googleRedirect, state));
  });

  app.get('/api/auth/google/callback', async (req, reply) => {
    const provider = oauthProvider(config, 'google');
    const { code, state } = req.query as { code?: string; state?: string };
    const claims = state ? await deps.signer.verify('oauth-state', state) : null;
    if (!provider || !code || claims?.p !== 'google') {
      return reply.redirect(`${config.webOrigin}/login?error=google`);
    }

    const token = await exchangeCode(provider, deps.fetch, code, googleRedirect);
    const account = await fetchAccount(provider, deps.fetch, token.accessToken);
    const email = account.email!.toLowerCase();

    const [found] = await db
      .select()
      .from(users)
      .where(or(eq(users.googleSub, account.id), eq(users.email, email)));
    let user = found;
    if (!user) {
      [user] = await db
        .insert(users)
        .values({ id: newId(), email, name: account.name, googleSub: account.id })
        .returning();
    } else if (!user.googleSub) {
      await db.update(users).set({ googleSub: account.id }).where(eq(users.id, user.id));
    }
    await startSession(deps, reply, user!.id);
    return reply.redirect(`${config.webOrigin}/app`);
  });
}

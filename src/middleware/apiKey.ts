import type { FastifyReply, FastifyRequest } from 'fastify';
import { UnauthorizedError } from '../errors.js';

/**
 * API key check for our own API. Accepts either `Authorization: Bearer <key>`
 * or `x-api-key: <key>`.
 *
 * An empty key list disables the check; config.ts refuses to boot in production
 * in that state, because an open proxy to someone's LinkedIn session is not a
 * thing to leave on the internet.
 */
export function makeApiKeyGuard(apiKeys: string[]) {
  const allowed = new Set(apiKeys);

  return async function guard(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (allowed.size === 0) return;

    const header = request.headers.authorization;
    const bearer = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
    const raw = request.headers['x-api-key'];
    const direct = Array.isArray(raw) ? raw[0] : raw;

    const presented = bearer || direct;
    if (!presented || !allowed.has(presented)) {
      throw new UnauthorizedError(
        'Provide a valid API key as "Authorization: Bearer <key>" or "x-api-key: <key>".',
      );
    }
  };
}

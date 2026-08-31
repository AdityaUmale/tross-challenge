import type { FastifyInstance, FastifyPluginOptions } from 'fastify';
import type { Config } from '../config.js';
import { describeConfig } from '../config.js';
import type { ProfileService } from '../service.js';

interface Options extends FastifyPluginOptions {
  service: ProfileService;
  config: Config;
}

/**
 * Liveness plus session state.
 *
 * Returns 503 when no LinkedIn session can serve a request, so a dead or
 * blocked cookie shows up as an explicit, readable failure rather than as
 * mysterious 500s on the profile route. Never echoes cookie material.
 */
export async function healthRoutes(app: FastifyInstance, opts: Options): Promise<void> {
  const { service, config } = opts;

  app.get(
    '/health',
    {
      schema: {
        tags: ['meta'],
        summary: 'Service and LinkedIn session health',
        response: {
          200: { type: 'object', additionalProperties: true },
          503: { type: 'object', additionalProperties: true },
        },
      },
    },
    async (_request, reply) => {
      const healthy = service.pool.healthy;
      const body = {
        status: healthy ? 'ok' : 'degraded',
        uptimeSeconds: Math.round(process.uptime()),
        config: describeConfig(config),
        ...service.describe(),
      };
      return reply.code(healthy ? 200 : 503).send(body);
    },
  );

  app.get('/', { schema: { hide: true } }, async (_request, reply) =>
    reply.send({
      name: 'linkedin-profile-api',
      docs: '/docs',
      health: '/health',
      profile: '/v1/profiles?url=https://www.linkedin.com/in/<username>',
    }),
  );
}

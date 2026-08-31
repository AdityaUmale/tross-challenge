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

  /**
   * Landing page.
   *
   * The submission form takes only this URL, so everything a reader needs has
   * to be reachable from here: the source, the interactive docs, a key that
   * works, and a request they can copy.
   */
  app.get(
    '/',
    {
      schema: {
        tags: ['meta'],
        summary: 'Service index: source, docs, and a working example',
        response: { 200: { type: 'object', additionalProperties: true } },
      },
    },
    async (request, reply) => {
      // `host` carries the port; behind Render's proxy, trustProxy resolves
      // both of these from the x-forwarded-* headers.
      const host = request.headers.host ?? request.hostname;
      const base = `${request.protocol}://${host}`;
      const key = config.apiKeys[0];

      return reply.send({
        name: 'linkedin-profile-api',
        description:
          'Accepts a LinkedIn profile URL and returns the profile as structured JSON, ' +
          'read from LinkedIn\'s internal Voyager API over plain HTTP. No browser, no HTML scraping.',
        source: 'https://github.com/AdityaUmale/tross-challenge',
        documentation: `${base}/docs`,
        health: `${base}/health`,
        endpoints: {
          profile: 'GET /v1/profiles?url=<linkedin profile url>',
          profilePost: 'POST /v1/profiles  {"url": "<linkedin profile url>"}',
          health: 'GET /health',
        },
        authentication: key
          ? {
              note:
                'Send the key as "x-api-key", "Authorization: Bearer <key>", or a "key" query parameter. ' +
                'The query parameter exists so a link works straight from a browser. /health and /docs need no key.',
              demoKey: key,
            }
          : { note: 'No key required on this deployment.' },
        example: key
          ? `curl -H 'x-api-key: ${key}' '${base}/v1/profiles?url=https://www.linkedin.com/in/williamhgates'`
          : `curl '${base}/v1/profiles?url=https://www.linkedin.com/in/williamhgates'`,
        tryInBrowser: key
          ? `${base}/v1/profiles?url=https://www.linkedin.com/in/williamhgates&key=${key}`
          : `${base}/v1/profiles?url=https://www.linkedin.com/in/williamhgates`,
      });
    },
  );
}

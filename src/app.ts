import Fastify, { type FastifyInstance } from 'fastify';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { Config } from './config.js';
import { AppError, isAppError } from './errors.js';
import { makeApiKeyGuard } from './middleware/apiKey.js';
import { healthRoutes } from './routes/health.js';
import { profileRoutes } from './routes/profiles.js';
import { ProfileService } from './service.js';

export async function buildApp(config: Config): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.logLevel,
      // Cookies must never reach the logs.
      redact: {
        paths: ['req.headers.cookie', 'req.headers.authorization', 'req.headers["x-api-key"]'],
        censor: '[redacted]',
      },
    },
    trustProxy: true,
  });

  const service = new ProfileService(config);

  await app.register(rateLimit, {
    max: 60,
    timeWindow: '1 minute',
    // Our own limiter, distinct from LinkedIn's; say which one is speaking.
    errorResponseBuilder: () => ({
      error: {
        code: 'RATE_LIMITED',
        message: 'Too many requests to this API. This is our rate limit, not LinkedIn\'s.',
      },
    }),
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'LinkedIn Profile API',
        description:
          'Accepts a LinkedIn profile URL and returns the profile as structured JSON.\n\n' +
          'Data is read from LinkedIn\'s internal Voyager API over plain HTTP requests. ' +
          'There is no browser automation and no HTML scraping anywhere in the request path.\n\n' +
          '## Trying it out\n\n' +
          '1. Click **Authorize** at the top right and paste the API key supplied with this submission. ' +
          'Either field works — `bearerAuth` or `apiKey`.\n' +
          '2. Open `GET /v1/profiles`, click **Try it out**, then **Execute**. ' +
          'The `url` field is pre-filled with a real profile.\n' +
          '3. Replace `url` with any LinkedIn member profile to fetch a different one.\n\n' +
          '`GET /health` needs no key and reports whether the LinkedIn session is live.\n\n' +
          '## Notes\n\n' +
          '- Responses are cached for 24 hours. Add `fresh=true` to force a live fetch.\n' +
          '- Sections a profile does not have come back as empty arrays. `meta.sections` ' +
          'reports the outcome of each one, so an absent section is distinguishable from a failed read.\n' +
          '- Company, school, job and post URLs are rejected with a 400 and an explanation.',
        version: '1.0.0',
      },
      components: {
        securitySchemes: {
          bearerAuth: { type: 'http', scheme: 'bearer' },
          apiKey: { type: 'apiKey', name: 'x-api-key', in: 'header' },
        },
      },
      security: [{ bearerAuth: [] }, { apiKey: [] }],
      tags: [
        { name: 'profiles', description: 'Profile lookup' },
        { name: 'meta', description: 'Health and diagnostics' },
      ],
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: { docExpansion: 'list', deepLinking: true },
  });

  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      // Expected outcomes; log at info so real faults stay visible.
      request.log.info({ code: error.code, status: error.status }, error.message);
      return reply.code(error.status).send(error.toBody());
    }

    // Schema validation failures from Fastify carry a `validation` array.
    const failure = error as { validation?: unknown; message?: string };
    if (failure.validation) {
      return reply.code(400).send({
        error: { code: 'INVALID_REQUEST', message: failure.message ?? 'Request failed schema validation.' },
      });
    }

    request.log.error({ err: error }, 'Unhandled error');
    return reply.code(500).send({
      error: { code: 'INTERNAL_ERROR', message: 'Something went wrong handling this request.' },
    });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.code(404).send({
      error: {
        code: 'NOT_FOUND',
        message: `No route for ${request.method} ${request.url}. See /docs.`,
      },
    }),
  );

  const guard = makeApiKeyGuard(config.apiKeys);

  await app.register(healthRoutes, { service, config });
  await app.register(profileRoutes, { service, guard });

  app.decorate('profileService', service);
  return app;
}

declare module 'fastify' {
  interface FastifyInstance {
    profileService: ProfileService;
  }
}

export { AppError };

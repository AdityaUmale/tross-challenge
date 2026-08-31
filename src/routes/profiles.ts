import type { FastifyInstance, FastifyPluginOptions, preHandlerHookHandler } from 'fastify';
import type { ProfileService } from '../service.js';
import {
  errorResponses,
  profileBodySchema,
  profileQuerystringSchema,
  profileResponseSchema,
} from './schemas.js';

interface ProfileQuery {
  url: string;
  fresh?: boolean;
  raw?: boolean;
  extras?: boolean;
}

interface Options extends FastifyPluginOptions {
  service: ProfileService;
  guard: preHandlerHookHandler;
}

export async function profileRoutes(app: FastifyInstance, opts: Options): Promise<void> {
  const { service, guard } = opts;

  const shared = {
    tags: ['profiles'],
    summary: 'Fetch a LinkedIn profile as structured JSON',
    description:
      'Resolves a LinkedIn member profile through LinkedIn\'s internal Voyager API — no browser, no HTML scraping — ' +
      'and returns name, headline, location, about, experience, education, skills, certifications, languages, ' +
      'volunteering, honors, projects, courses, publications and profile images, where LinkedIn exposes them.\n\n' +
      'Sections LinkedIn does not return come back as empty arrays; `meta.sections` reports the outcome of each one ' +
      'so an absent section can be told apart from a failed read.',
    response: { 200: profileResponseSchema, ...errorResponses },
  };

  app.get<{ Querystring: ProfileQuery }>(
    '/v1/profiles',
    {
      preHandler: guard,
      schema: { ...shared, querystring: profileQuerystringSchema },
    },
    async (request) => {
      const { url, fresh, raw, extras } = request.query;
      return service.getProfile(url, {
        fresh: Boolean(fresh),
        raw: Boolean(raw),
        extras: Boolean(extras),
      });
    },
  );

  // POST exists so long URLs can be pasted without query-string escaping.
  app.post<{ Body: ProfileQuery }>(
    '/v1/profiles',
    {
      preHandler: guard,
      schema: { ...shared, body: profileBodySchema },
    },
    async (request) => {
      const { url, fresh, raw, extras } = request.body;
      return service.getProfile(url, {
        fresh: Boolean(fresh),
        raw: Boolean(raw),
        extras: Boolean(extras),
      });
    },
  );
}

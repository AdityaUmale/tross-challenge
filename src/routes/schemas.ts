/**
 * JSON Schema for the routes. Fastify uses these for request validation and
 * @fastify/swagger turns them into the OpenAPI document served at /docs, so the
 * API documentation and the validation never drift apart.
 *
 * Objects are `additionalProperties: true` on purpose: Fastify serializes
 * responses from these schemas, and a strict schema would silently drop fields
 * the parsers add.
 */

const partialDate = {
  type: 'object',
  additionalProperties: true,
  properties: {
    year: { type: ['integer', 'null'] },
    month: { type: ['integer', 'null'] },
    day: { type: ['integer', 'null'] },
  },
} as const;

const dateRange = {
  type: 'object',
  additionalProperties: true,
  properties: {
    start: { ...partialDate, nullable: true },
    end: { ...partialDate, nullable: true },
    current: { type: 'boolean' },
    durationMonths: { type: ['integer', 'null'] },
  },
} as const;

const imageSet = {
  type: ['object', 'null'],
  additionalProperties: true,
  properties: {
    largest: { type: ['string', 'null'] },
    sizes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: true,
        properties: {
          url: { type: 'string' },
          width: { type: ['integer', 'null'] },
          height: { type: ['integer', 'null'] },
        },
      },
    },
  },
} as const;

const arrayOfObjects = { type: 'array', items: { type: 'object', additionalProperties: true } } as const;

export const profileResponseSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    inputUrl: { type: 'string' },
    profile: {
      type: 'object',
      additionalProperties: true,
      properties: {
        publicIdentifier: { type: ['string', 'null'] },
        entityUrn: { type: ['string', 'null'] },
        memberId: { type: ['string', 'null'] },
        profileUrl: { type: 'string' },
        firstName: { type: ['string', 'null'] },
        lastName: { type: ['string', 'null'] },
        fullName: { type: ['string', 'null'] },
        headline: { type: ['string', 'null'] },
        about: { type: ['string', 'null'] },
        location: {
          type: 'object',
          additionalProperties: true,
          properties: {
            display: { type: ['string', 'null'] },
            country: { type: ['string', 'null'] },
            countryCode: { type: ['string', 'null'] },
            postalCode: { type: ['string', 'null'] },
            geoUrn: { type: ['string', 'null'] },
          },
        },
        industry: { type: ['string', 'null'] },
        pronouns: { type: ['string', 'null'] },
        isOpenToWork: { type: 'boolean' },
        isHiring: { type: 'boolean' },
        isPremium: { type: 'boolean' },
        isInfluencer: { type: 'boolean' },
        connectionsCount: { type: ['integer', 'null'] },
        followersCount: { type: ['integer', 'null'] },
        connectionDegree: { type: ['string', 'null'] },
        images: {
          type: 'object',
          additionalProperties: true,
          properties: { profile: imageSet, background: imageSet },
        },
      },
    },
    experience: arrayOfObjects,
    education: arrayOfObjects,
    skills: arrayOfObjects,
    certifications: arrayOfObjects,
    languages: arrayOfObjects,
    volunteering: arrayOfObjects,
    honors: arrayOfObjects,
    projects: arrayOfObjects,
    courses: arrayOfObjects,
    publications: arrayOfObjects,
    meta: {
      type: 'object',
      additionalProperties: true,
      properties: {
        fetchedAt: { type: 'string' },
        cached: { type: 'boolean' },
        source: { type: 'string' },
        sections: { type: 'object', additionalProperties: true },
        warnings: { type: 'array', items: { type: 'string' } },
        elapsedMs: { type: 'integer' },
      },
    },
    raw: { type: 'object', additionalProperties: true, nullable: true },
  },
} as const;

export const errorResponseSchema = {
  type: 'object',
  additionalProperties: true,
  properties: {
    error: {
      type: 'object',
      additionalProperties: true,
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        details: { type: 'object', additionalProperties: true },
      },
    },
  },
} as const;

const urlDescription =
  'A LinkedIn member profile URL. Full URLs, bare paths and bare usernames are all accepted, ' +
  'as are regional hosts and ?trk= tracking parameters. Company, school and post URLs are rejected.';

export const profileQuerystringSchema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1, description: urlDescription, examples: ['https://www.linkedin.com/in/williamhgates'] },
    fresh: { type: 'boolean', default: false, description: 'Bypass the cache and refetch from LinkedIn.' },
    raw: { type: 'boolean', default: false, description: 'Include the raw Voyager payload alongside the parsed profile.' },
  },
} as const;

export const profileBodySchema = {
  type: 'object',
  required: ['url'],
  properties: {
    url: { type: 'string', minLength: 1, description: urlDescription },
    fresh: { type: 'boolean', default: false },
    raw: { type: 'boolean', default: false },
  },
} as const;

export const errorResponses = {
  400: { ...errorResponseSchema, description: 'The URL is not a LinkedIn member profile.' },
  401: { ...errorResponseSchema, description: 'Missing API key, or LinkedIn rejected the session cookie.' },
  404: { ...errorResponseSchema, description: 'No such profile, or it is not visible to the session.' },
  429: { ...errorResponseSchema, description: 'Rate limited, by this API or by LinkedIn.' },
  502: { ...errorResponseSchema, description: 'LinkedIn returned an error or an unrecognised payload.' },
  503: { ...errorResponseSchema, description: 'No healthy LinkedIn session is configured or available.' },
} as const;

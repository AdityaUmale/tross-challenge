# LinkedIn Profile API

Accepts a LinkedIn profile URL and returns the profile as structured JSON.

Data comes from LinkedIn's internal Voyager API over plain HTTP requests. There
is no browser automation and no HTML parsing anywhere in the request path.

```bash
curl -H 'Authorization: Bearer YOUR_KEY' \
  'https://your-host/v1/profiles?url=https://www.linkedin.com/in/williamhgates'
```

Interactive API documentation is at `/docs`.

## Contents

- [How it works](#how-it-works)
- [Quickstart](#quickstart)
- [Get your LinkedIn cookie](#get-your-linkedin-cookie)
- [API reference](#api-reference)
- [Approach](#approach)
- [Limitations](#limitations)
- [Security](#security)
- [Verify it locally](#verify-it-locally)
- [Deploy](#deploy)

## How it works

The LinkedIn web app doesn't render profiles from server HTML. It calls a
private JSON API at `/voyager/api/`, authenticated with session cookies rather
than OAuth. This service calls the same endpoints with `fetch`.

```
GET /v1/profiles?url=…
  │
  ├─ parse and validate the URL
  ├─ check the cache
  ▼
Voyager client
  ├─ session pool, cookie bootstrap
  ├─ concurrency cap, retry with backoff
  ▼
GET /voyager/api/identity/dash/profiles?q=memberIdentity&…
  ▼
Entity graph: resolve URN pointers
  ▼
Parsers: typed sections
  ▼
JSON + meta.sections
```

## Quickstart

Requires Node.js 20 or later.

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create your environment file:

   ```bash
   cp .env.example .env
   ```

3. Add your `li_at` cookie to `.env`. To find it, see
   [Get your LinkedIn cookie](#get-your-linkedin-cookie).

4. Confirm the cookie works:

   ```bash
   npm run probe
   ```

   This calls `/voyager/api/me` and prints the account you're authenticated as.
   If it fails, nothing else works, so fix this first.

5. Fetch a profile from the command line:

   ```bash
   npm run probe -- https://www.linkedin.com/in/williamhgates
   ```

6. Start the server:

   ```bash
   npm run dev
   ```

   Open `http://localhost:8080/docs`.

## Get your LinkedIn cookie

Use a secondary LinkedIn account if you have one. Sustained API traffic from a
single account can get that account restricted.

1. Sign in to LinkedIn in Chrome.
2. Open DevTools and go to **Application > Cookies > https://www.linkedin.com**.
3. Copy the value of the `li_at` cookie into `LI_AT` in your `.env` file.
4. In the DevTools console, run `navigator.userAgent` and copy the result into
   `LI_USER_AGENT`.

The `li_at` cookie is `httpOnly`, so `document.cookie` doesn't return it. The
Application panel is the only way to read it.

Match `LI_USER_AGENT` to the browser that created the cookie. A mismatch between
the user agent and the session shortens how long the cookie lasts.

Treat `li_at` as a password. It grants full access to the account.

`LI_JSESSIONID` is optional. The client derives a `JSESSIONID` and its CSRF
token from `li_at` on first use. For why that matters, see
[Session bootstrap](#session-bootstrap).

## API reference

All profile endpoints require an API key when `API_KEYS` is set. Pass it as
either `Authorization: Bearer KEY` or `x-api-key: KEY`. The key for the hosted
instance is supplied with the submission rather than committed here.

`/health` and `/docs` need no key.

### Get a profile

```
GET  /v1/profiles?url=URL
POST /v1/profiles     {"url": "URL"}
```

`POST` accepts the same fields in a JSON body, which avoids escaping long URLs.

| Parameter | Type | Description |
|---|---|---|
| `url` | string | Required. A LinkedIn member profile URL. |
| `fresh` | boolean | Bypass the cache and refetch from LinkedIn. Defaults to `false`. |
| `raw` | boolean | Include the raw Voyager payload next to the parsed profile. Defaults to `false`. |
| `extras` | boolean | Also fetch the top card and page the skills. Two or more extra upstream requests, which shortens session lifetime. Defaults to `false`. |

The `url` parameter accepts full URLs, bare paths, and bare usernames. Regional
hosts, locale prefixes, trailing slashes, and `?trk=` tracking parameters are
all handled:

```
https://www.linkedin.com/in/williamhgates
https://in.linkedin.com/in/williamhgates/
linkedin.com/in/williamhgates?trk=public_profile_browsemap
https://www.linkedin.com/in/ACwAAABc1234xyz
williamhgates
```

Company, school, job, post, and Sales Navigator URLs return `400`.

### Response

```jsonc
{
  "inputUrl": "https://www.linkedin.com/in/ada-lovelace",
  "profile": {
    "publicIdentifier": "ada-lovelace",
    "entityUrn": "urn:li:fsd_profile:ACoAA…",
    "memberId": "ACoAA…",
    "profileUrl": "https://www.linkedin.com/in/ada-lovelace",
    "firstName": "Ada",
    "lastName": "Lovelace",
    "fullName": "Ada Lovelace",
    "headline": "Principal Engineer at Analytical Engines",
    "about": "Mathematician. I write about compilers…",
    "location": {
      "display": "London, England, United Kingdom",
      "country": null,
      "countryCode": "GB",
      "postalCode": null,
      "geoUrn": "urn:li:fsd_geo:102257491"
    },
    "industry": "Software Development",
    "pronouns": null,
    "isOpenToWork": true,
    "isHiring": false,
    "isPremium": true,
    "isInfluencer": false,
    "connectionsCount": 500,
    "followersCount": 12043,
    "connectionDegree": "2nd",
    "images": {
      "profile": {
        "largest": "https://media.licdn.com/dms/image/…/shrink_800_800/photo.jpg",
        "sizes": [{ "url": "…", "width": 800, "height": 800 }]
      },
      "background": null
    }
  },
  "experience": [
    {
      "title": "Principal Engineer",
      "employmentType": "Full time",
      "companyName": "Analytical Engines",
      "companyUrn": "urn:li:fsd_company:99001",
      "companyUrl": "https://www.linkedin.com/company/99001",
      "companyLogo": { "largest": "…", "sizes": [] },
      "location": "London, United Kingdom",
      "description": "Compiler correctness and developer tooling.",
      "dates": {
        "start": { "year": 2022, "month": 3, "day": null },
        "end": null,
        "current": true,
        "durationMonths": 42
      }
    }
  ],
  "education": [],
  "skills": [{ "name": "TypeScript", "endorsementCount": null }],
  "certifications": [],
  "languages": [{ "name": "English", "proficiency": "Native or bilingual" }],
  "volunteering": [],
  "honors": [],
  "projects": [],
  "courses": [],
  "publications": [],
  "meta": {
    "fetchedAt": "2026-08-30T18:00:00.000Z",
    "cached": false,
    "source": "voyager-dash:com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101",
    "sections": { "profile": "ok", "experience": "ok", "skills": "ok", "honors": "empty" },
    "warnings": [],
    "elapsedMs": 1840
  }
}
```

Missing fields are `null` and missing sections are `[]`. Nothing is invented.

Dates stay structured rather than formatted, because a consumer can format a
`{year, month}` pair but can't reliably parse a display string back.

#### Section statuses

`meta.sections` reports each section separately, so you can tell an absent
section from one that failed to parse.

| Status | Meaning |
|---|---|
| `ok` | Parsed, and contains data. |
| `empty` | Parsed, and the profile genuinely has nothing here. |
| `partial` | Parsed, but incomplete. Skills report this when paging fails. |
| `unavailable` | Parsing failed. See `meta.warnings`. |

### Health

```
GET /health
```

Returns `200` when at least one LinkedIn session can serve a request, and `503`
otherwise. The response reports session state, cooldowns, and cache size, and
never includes cookie values. No API key is required.

Use this to tell a dead cookie apart from a broken deployment.

### Errors

Every error returns `{"error": {"code": "…", "message": "…"}}`.

| Status | Code | Cause |
|---|---|---|
| 400 | `INVALID_URL` | The URL isn't a LinkedIn member profile. |
| 400 | `INVALID_REQUEST` | The request failed schema validation. |
| 401 | `UNAUTHORIZED` | The API key is missing or wrong. |
| 401 | `AUTH_EXPIRED` | LinkedIn rejected the session cookie. |
| 404 | `PROFILE_NOT_FOUND` | No such profile, or it isn't visible to the session. |
| 429 | `RATE_LIMITED` | Throttled by this API or by LinkedIn. |
| 502 | `UPSTREAM_ERROR` | LinkedIn returned an error. |
| 502 | `SCHEMA_DRIFT` | The response shape changed. Recapture endpoints. |
| 503 | `NO_HEALTHY_SESSION` | No cookie is configured, or all are cooling down. |

## Approach

### Finding the endpoints

Open a LinkedIn profile with DevTools recording, filter the Network panel to
`voyager`, and the profile page turns out to be assembled from a handful of JSON
calls. Copying one as cURL and replaying it in a terminal, then deleting headers
until it breaks, leaves this minimum:

```bash
curl 'https://www.linkedin.com/voyager/api/identity/dash/profiles?q=memberIdentity&memberIdentity=williamhgates&decorationId=com.linkedin.voyager.dash.deco.identity.profile.FullProfileWithEntities-101' \
  -H 'cookie: li_at=…; JSESSIONID="ajax:…"' \
  -H 'csrf-token: ajax:…' \
  -H 'x-restli-protocol-version: 2.0.0' \
  -H 'x-li-lang: en_US' \
  -H 'accept: application/vnd.linkedin.normalized+json+2.1' \
  -H 'user-agent: <the UA that created the cookie>'
```

A `200` from that command, with an `included` array containing `firstName`, is
proof the browserless path works.

Two headers matter more than the rest:

- `csrf-token` must be the `JSESSIONID` value with its surrounding quotation
  marks removed. LinkedIn stores the cookie as `"ajax:123"` and expects the
  header as `ajax:123`.
- `accept: application/vnd.linkedin.normalized+json+2.1` changes the response
  format, and everything downstream depends on it.

To reproduce this, save a HAR from the Network panel into `captures/` and run:

```bash
npm run har -- captures/your-capture.har
```

The extractor lists every Voyager endpoint observed, records the decoration IDs
and GraphQL query IDs in use, updates `config/endpoints.json`, and writes
response bodies to `tests/fixtures/` with contact details redacted.

### Why REST decorations, not GraphQL

LinkedIn serves profile data through two families:

- **REST.li with a `decorationId`**, at `/identity/dash/profiles`. Returns typed
  entities and packs almost the whole profile into one response.
- **GraphQL**, at `/graphql?queryId=voyagerIdentityDashProfileComponents.HASH`.
  Returns a generic component tree in which a field's meaning depends on its
  position in the rendered layout.

This service uses the REST family. The GraphQL route carries two costs at once:
the `queryId` hash changes whenever LinkedIn deploys, and reading a component
tree means inferring that `titleV2.text.text` is a job title in one section and
a school name in another.

Decoration IDs also drift, but they carry an explicit version suffix
(`FullProfileWithEntities-101`), so recovery is a config change. Endpoint
identifiers live in `config/endpoints.json`, and the client walks a fallback
ladder of adjacent versions before giving up.

### The normalized entity graph

With the `normalized+json+2.1` accept header, LinkedIn returns a flattened
object graph:

```json
{
  "data": { "*elements": ["urn:li:fsd_profile:ACoAA…"] },
  "included": [
    {
      "entityUrn": "urn:li:fsd_profile:ACoAA…",
      "$type": "com.linkedin.voyager.dash.identity.profile.Profile",
      "firstName": "Ada",
      "*profilePositionGroups": "urn:li:fsd_profile:ACoAA…/positionGroups"
    }
  ]
}
```

Every entity is addressable by `entityUrn`, and a field whose name starts with
`*` is a pointer rather than a value. `src/linkedin/graph.ts` indexes `included`
by URN and walks those pointers, so the parsers work with plain objects.

Three details in that resolver are easy to get wrong, and all three cost real
debugging time here:

- Only `*`-prefixed keys are pointers. A plain string stays a string even when it
  looks like a URN — otherwise `entityUrn` resolves to the entity it names and
  the ID disappears.
- The graph contains cycles. A position points at a company, whose entity points
  back at people. The resolver tracks the current branch and stops on a revisit.
- Follow pointers; don't scan by type. `included` carries several `Geo` entities,
  and only the one the profile points at has a name. Scanning for the first `Geo`
  returns an empty stub and the location silently disappears.

Keys are also filtered: `included` is an untrusted document, and assigning
`out['__proto__']` by bracket notation would invoke the prototype setter.

### Session bootstrap, and why CSRF is not a blocker

Voyager needs both `li_at` and a `JSESSIONID`, but only `li_at` has to be a
secret. On first use the client requests a LinkedIn page with `li_at` alone and
reads `JSESSIONID` from `Set-Cookie`.

That request doesn't always set one. Rather than fail, the client mints its own:
LinkedIn validates CSRF by **double submission**, meaning the `csrf-token` header
only has to match the `JSESSIONID` cookie sent with it. The value doesn't have to
be server-issued. Authentication comes from `li_at`; the token satisfies the CSRF
check and nothing more.

The warm-up request is still worth making, because it refreshes the `lidc`
datacenter affinity cookie, which reduces HTTP 999 responses.

### Three things that all look like a redirect

Voyager answers with 3xx in situations that need opposite handling, so redirects
are followed manually rather than by the HTTP client:

| Response | Meaning | Handling |
|---|---|---|
| 302 to `/checkpoint/` or `/uas/login` | The account needs verification in a browser | Fail with `AUTH_EXPIRED` |
| 302 to the same URL, with `li_at` expired via `Max-Age=0` and `clear-site-data` | LinkedIn has invalidated the session | Fail with `AUTH_EXPIRED` |
| 302 carrying a new `lidc` cookie | Datacenter affinity | Replay with the updated jar |

An invalid session is a redirect, not a 401. Following it naively loops forever,
which is what the third case looks like until you inspect the `Set-Cookie`
headers. Redirects are also confined to `linkedin.com`: every hop resends
`li_at`, so an off-site `Location` would hand the session cookie to that host.

### One request per profile

The largest reliability problem in this service was self-inflicted, and it is
worth stating plainly because the obvious diagnosis was wrong.

Sessions kept dying after a handful of lookups, and the working theory was that
LinkedIn blocks datacenter IP addresses. It does treat them with more suspicion
— but that was not what was happening here. A single call to `/v1/profiles` was
issuing **four** authenticated requests: an HTML page load to mint a session,
the full-profile call, a top-card call, and one or more skills pages. Four
identity-graph requests in about a second is a scrape signature regardless of
where they come from.

The full-profile decoration already carries every field this API returns. The
extra calls existed for follower counts and endorsement counts, and this
projection does not expose endorsements at all. Cutting the fan-out to one
request, and supplying a real browser cookie jar so no bootstrap request is
needed, was enough for the same session to serve profiles from a datacenter
container without being invalidated.

The extras are still available behind `?extras=true` for callers who want the
top card and paged skills and accept the cost to session lifetime.

### The client fingerprint has to be self-consistent

`x-li-track` announces a form factor, and it must agree with the `User-Agent`.
Claiming `DESKTOP` while sending a mobile UA is a contradictory client, and
LinkedIn invalidates sessions that look automated. The form factor is derived
from `LI_USER_AGENT` rather than hardcoded.

Set `LI_USER_AGENT` to the user agent of the browser that created the cookie.

### Staying unblocked

LinkedIn returns HTTP 999 for traffic it considers automated, and it applies
that judgment more readily to datacenter IP addresses than to residential ones.
The client keeps the request pattern conservative:

- Concurrency is capped at 2. Steady traffic survives better than bursts.
- Retries use exponential backoff with jitter.
- A 999 or 429 puts the session into a 15-minute cooldown and rotates to the
  next one if the pool has more than one cookie.
- Successful responses are cached for 6 hours, so refetching a profile costs
  nothing upstream.

## Limitations

- **Endorsement counts aren't available.** The `Skill` entity in this projection
  carries a name and nothing else, so `endorsementCount` is always `null`.
  Retrieving counts needs a separate endpoint that this service doesn't call.
- **The cookie is the weak point.** `li_at` lasts weeks to months, but LinkedIn
  invalidates it early if traffic looks automated. `/health` returns `503` when
  this happens, so the failure is legible rather than a mystery. Refresh the
  cookie and redeploy. Two things keep a session alive in practice: one request
  per profile, and not using the same cookie from a browser and this service at
  the same time.
- **Rate matters more than volume.** Steady, spaced requests are tolerated;
  bursts are not. Concurrency is capped at 2 and responses are cached for 24
  hours by default.
- **Datacenter IP addresses attract more blocking.** Expect a higher HTTP 999
  rate from a hosted deployment than from a laptop. Warm the cache (see
  [Deploy](#deploy)) so a temporary block doesn't stop the service returning data.
- **Decoration versions drift.** When LinkedIn bumps a projection version, the
  configured decoration starts returning `400`. The client tries the adjacent
  versions in `config/endpoints.json` and reports `SCHEMA_DRIFT` if all fail.
  Recapture a HAR and rerun `npm run har`.
- **Visibility depends on the account.** LinkedIn shows less of an
  out-of-network or private profile, and those sections return `[]` rather than
  an error. A new account with no connections sees markedly less than an
  established one.
- **Contact details are excluded.** Email addresses and phone numbers are never
  requested, even where LinkedIn exposes them.
- **This is an unofficial API.** Voyager is undocumented, unversioned, and can
  change without notice. Using it is inconsistent with LinkedIn's terms of
  service. This project was built as a technical assignment, runs on its
  operator's own credentials, and is not intended for bulk collection.

## Security

- `li_at` is read from the environment only. It is never logged, never returned
  in a response, and never written to the repository. `.env`, `*.har` files and
  probe dumps are all excluded by `.gitignore`.
- Redirects are confined to `linkedin.com`, because each hop resends the session
  cookie.
- Requests to the profile endpoint require an API key. The server refuses to
  start in production without `API_KEYS`, since an unauthenticated proxy to a
  LinkedIn session is not something to expose.
- Input URLs are validated against `linkedin.com` before any request is made,
  which keeps the `url` parameter from reaching arbitrary hosts.
- Test fixtures are captured from public profiles with contact details, postal
  codes and tracking identifiers stripped.

## Verify it locally

Tests run against fixtures with no network and no credentials:

```bash
npm run typecheck
npm test
```

The suite covers the entity graph, including cycles, dangling pointers and
prototype-polluting keys; URL parsing across the shapes people paste; image
extraction; cache expiry, eviction and restart persistence; the redirect host
allowlist; and the parsers against a sparse profile, a synthetic dense one, and
a real captured Voyager payload in `tests/fixtures/real-profile-dash.json`.

To check the HTTP surface without a LinkedIn cookie:

```bash
npm run dev

curl 'localhost:8080/health'
curl 'localhost:8080/v1/profiles?url=https://www.linkedin.com/company/microsoft'   # 400
curl 'localhost:8080/v1/profiles'                                                  # 400
curl 'localhost:8080/v1/profiles?url=https://www.linkedin.com/in/williamhgates'    # 503
```

## Deploy

The service is a container and runs anywhere that takes a Dockerfile. For
step-by-step instructions, see [deploy/RENDER.md](deploy/RENDER.md), or
[deploy/HUGGINGFACE.md](deploy/HUGGINGFACE.md) for Hugging Face Spaces.

Build and run the container:

```bash
docker build -t linkedin-profile-api .
docker run -p 8080:8080 --env-file .env linkedin-profile-api
```

Set these variables in your host's secret store:

| Variable | Required | Notes |
|---|---|---|
| `LI_AT` | Yes | Session cookie. Comma-separate several to pool them. |
| `API_KEYS` | Yes in production | Comma-separated. The server refuses to start in production without it. |
| `LI_USER_AGENT` | Recommended | Match the browser that created the cookie. |
| `LI_JSESSIONID` | No | Bootstrapped from `LI_AT`. |
| `CACHE_FILE` | Recommended | Path for the cache snapshot, so warmed profiles survive a restart. |
| `PORT` | No | Supplied by most hosts. Defaults to `8080`. |

Point the platform's health check at `/`, not `/health`. The health endpoint
answers `503` when the LinkedIn cookie is dead, which is correct for a caller
but makes a liveness probe restart a service that is running fine.

After deploying, check `/health`, then one known profile, then a nonexistent
username, then a request with no API key.

### Warm the cache

Set `CACHE_FILE` so the cache survives a restart, then warm it:

```bash
npm run warm -- --remote https://your-host --key YOUR_KEY \
  https://www.linkedin.com/in/williamhgates \
  https://www.linkedin.com/in/satyanadella
```

Requests go out one at a time, eight seconds apart. Warmed profiles are then
served from cache, which keeps a live LinkedIn call off the critical path and
means a temporary block doesn't stop the service returning real data.
`meta.cached` and `meta.fetchedAt` report this honestly, and `?fresh=true`
bypasses the cache to exercise the live path.

Don't load-test a deployment. Every uncached request uses a real LinkedIn
session, and volume is what gets an account restricted.

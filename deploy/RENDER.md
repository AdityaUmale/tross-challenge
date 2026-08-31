# Deploying to Render

Render's free tier runs the Dockerfile in this repository unchanged and issues
HTTPS automatically. No payment card is required.

## 1. Create the service

1. Sign up at https://render.com. Use an email address that isn't tied to an
   account with an outstanding balance, or the free tier stays unavailable.
2. Choose **New > Web Service** and connect this GitHub repository.
3. Set:

   | Field | Value |
   |---|---|
   | Language | **Docker** |
   | Branch | `main` |
   | Instance type | **Free** |
   | Health check path | **`/`** |

Set the health check to `/`, not `/health`. The health endpoint answers `503`
when the LinkedIn cookie is dead, which is the right answer for a caller but
would make Render treat the service as failed and restart it repeatedly. `/`
answers `200` whenever the process is running.

## 2. Add the environment variables

Under **Environment**, add:

| Key | Value |
|---|---|
| `LI_AT` | Your `li_at` cookie, copied from desktop Chrome |
| `LI_USER_AGENT` | The `navigator.userAgent` of that same browser |
| `API_KEYS` | A key you generate, e.g. `openssl rand -hex 24` |
| `NODE_ENV` | `production` |
| `CACHE_FILE` | `/tmp/cache.json` |
| `CACHE_TTL_SECONDS` | `86400` |

Render supplies `PORT` itself. Don't set it.

## 3. Verify

```bash
HOST=https://<your-service>.onrender.com
KEY=<the API_KEYS value>

curl "$HOST/health"
curl -H "x-api-key: $KEY" "$HOST/v1/profiles?url=https://www.linkedin.com/in/williamhgates"
curl "$HOST/v1/profiles?url=https://www.linkedin.com/in/williamhgates"                        # 401
curl -H "x-api-key: $KEY" "$HOST/v1/profiles?url=https://www.linkedin.com/company/microsoft"  # 400
```

`/health` reporting `"status": "ok"` means the LinkedIn session is live. `503`
means the cookie needs refreshing.

## 4. Keep the instance awake

Free instances sleep after roughly 15 minutes without traffic and take close to
a minute to wake. The first request after a sleep is slow, and because free
instances have no persistent disk, a sleep also empties the cache.

A scheduled ping avoids both. At https://cron-job.org (free, no card), create a
job that requests `https://<your-service>.onrender.com/` every 10 minutes.

The free tier allows 750 instance-hours a month, and a continuously awake
service uses about 730, so this fits.

## 5. Warm the cache

Once the service is awake, run this shortly before the API is reviewed:

```bash
npm run warm -- --remote "$HOST" --key "$KEY" \
  https://www.linkedin.com/in/williamhgates \
  https://www.linkedin.com/in/satyanadella \
  https://www.linkedin.com/in/reidhoffman
```

Warmed profiles are then served from cache, so a reviewer sees real data without
a live LinkedIn call.

## Refreshing the cookie

When `/health` reports `503`, sign in to LinkedIn in desktop Chrome, clear any
security checkpoint, copy a fresh `li_at`, and update the `LI_AT` variable.
Render redeploys automatically.

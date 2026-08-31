# Deploying to Hugging Face Spaces

Hugging Face Spaces runs a Dockerfile directly, gives you HTTPS, and needs no
payment card. A Space is its own git repository, so the deployment is a push.

## 1. Create the Space

Go to https://huggingface.co/new-space and set:

| Field | Value |
|---|---|
| Space name | `linkedin-profile-api` |
| License | `mit` |
| SDK | **Docker** > Blank |
| Hardware | CPU basic (free) |
| Visibility | Public |

## 2. Add the secrets

In the Space, go to **Settings > Variables and secrets** and add these as
**Secrets**, not variables, so they stay hidden:

| Name | Value |
|---|---|
| `LI_AT` | Your `li_at` cookie, copied from desktop Chrome |
| `LI_USER_AGENT` | The `navigator.userAgent` of that same browser |
| `API_KEYS` | A key you generate, e.g. `openssl rand -hex 24` |

Add these as plain **Variables**:

| Name | Value |
|---|---|
| `NODE_ENV` | `production` |
| `CACHE_FILE` | `/tmp/cache.json` |

Free Spaces have ephemeral storage, so `/tmp` is the right place for the cache
snapshot. It survives a sleep and wake, not a rebuild.

## 3. Push the code

The Space needs a `README.md` whose front matter declares the SDK and port,
which the repository README doesn't carry. Keep that on a deployment branch:

```bash
git checkout -b hf-space
cat deploy/space-header.md README.md > README.space.md
mv README.space.md README.md
git commit -am "Add Space front matter"

git remote add space https://huggingface.co/spaces/<your-username>/linkedin-profile-api
git push space hf-space:main
git checkout main
```

Use a Hugging Face access token with write scope as the password when git asks.
Create one at https://huggingface.co/settings/tokens.

The Space builds the Dockerfile and publishes at
`https://<your-username>-linkedin-profile-api.hf.space`.

## 4. Verify

```bash
HOST=https://<your-username>-linkedin-profile-api.hf.space
KEY=<the API_KEYS value>

curl "$HOST/health"
curl -H "x-api-key: $KEY" "$HOST/v1/profiles?url=https://www.linkedin.com/in/williamhgates"
curl "$HOST/v1/profiles?url=https://www.linkedin.com/in/williamhgates"     # 401
curl -H "x-api-key: $KEY" "$HOST/v1/profiles?url=https://www.linkedin.com/company/microsoft"  # 400
```

`/health` reporting `"status": "ok"` means the LinkedIn session is live. A `503`
means the cookie needs refreshing.

## 5. Warm the cache

Run this shortly before the API is reviewed:

```bash
npm run warm -- --remote "$HOST" --key "$KEY" \
  https://www.linkedin.com/in/williamhgates \
  https://www.linkedin.com/in/satyanadella \
  https://www.linkedin.com/in/reidhoffman
```

Warmed profiles are served from cache afterwards, so a reviewer sees real data
without a live LinkedIn call.

## Refreshing the cookie

When `/health` reports `503`, sign in to LinkedIn in desktop Chrome, clear any
security checkpoint, copy a fresh `li_at`, and update the `LI_AT` secret. The
Space restarts automatically.

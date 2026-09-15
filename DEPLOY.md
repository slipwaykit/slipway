# Deploying Slipway

Two services, deployed from this GitHub repository:

| Service | Host | Why there |
| --- | --- | --- |
| `backend/` | Railway | Needs a persistent disk for SQLite and a long-running process for the 15-minute poller. Vercel's serverless runtime has neither. |
| `frontend/` | Vercel | Static and server-rendered Next.js; reads only from the backend. |

The backend image is a plain Dockerfile, so Fly.io or Render work the same way
if you prefer them; only the volume and variable steps differ.

## 1. Backend on Railway

1. **New Project → Deploy from GitHub repo →** `slipwaykit/slipway`. Railway
   reads [`railway.toml`](railway.toml), which points it at
   [`backend/Dockerfile`](backend/Dockerfile) and `/api/health`.
2. **Add a Volume** to the service, mounted at **`/data`**. Without it the
   database is wiped on every redeploy and history starts from zero.
3. **Variables:**

   | Variable | Value |
   | --- | --- |
   | `NODE_ENV` | `production` |
   | `SLIPWAY_ATTESTOR_SECRET` | output of `stellar keys secret slipway`, pasted into Railway's variable editor. Never commit it or put it in chat. |
   | `SLIPWAY_ATTESTATIONS_CONTRACT` | `CBPHQB7YKLPLM7CZWCWUW6QQOBF77QMOTAHHO3PMP25AW4IXUMMSDFMT` |
   | `SLIPWAY_CORS_ORIGINS` | your Vercel URL, once you have it (step 2.4). `*` works until then. |

   `PORT` is injected by Railway and `SLIPWAY_DB_PATH` defaults to
   `/data/slipway.db` in the image. The app **refuses to start** with
   `NODE_ENV=production` and no secret, by design.
4. **Settings → Networking → Generate Domain.** Check
   `https://<domain>/api/health` returns `"status":"ok"` and
   `"attestorConfigured":true`.

## 2. Frontend on Vercel

1. **Add New → Project →** import `slipwaykit/slipway`.
2. **Root Directory:** `frontend`. [`frontend/vercel.json`](frontend/vercel.json)
   sets the install to `pnpm install --frozen-lockfile --filter "frontend..."`,
   which installs the frontend and core only.
3. **Environment variables:**

   | Variable | Value |
   | --- | --- |
   | `NEXT_PUBLIC_SLIPWAY_API_URL` | `https://<railway-domain>` |
   | `NEXT_PUBLIC_SLIPWAY_ATTESTATIONS_CONTRACT` | `CBPHQB7YKLPLM7CZWCWUW6QQOBF77QMOTAHHO3PMP25AW4IXUMMSDFMT` |
   | `ENABLE_EXPERIMENTAL_COREPACK` | `1`, so Vercel uses the `pnpm@12.4.1` pinned in `package.json` |

   `NEXT_PUBLIC_*` values are baked in at build time; changing one needs a redeploy.
4. **Deploy**, then set `SLIPWAY_CORS_ORIGINS` on Railway to the Vercel URL and
   redeploy the backend.
5. Put the live URL in the root README.

## What was verified before this guide was written

Rehearsed on 2026-09-15 in clean copies of the repository, with the exact
install and build commands both hosts run:

- The filtered backend install built the workspace packages without installing
  any frontend dependency; the filtered frontend install built with `next build`
  without installing any backend dependency.
- The rehearsed backend, run as the image runs it (`node --import tsx`,
  `NODE_ENV=production`), refused to start without the secret; with it, it served
  real quotes, returned CORS headers only for the configured origin, and the
  secret appeared in neither `/api/health` nor the server log.

**Not verified:** the Docker image itself was not built (no Docker daemon was
available), and nothing has run on Railway or Vercel yet. The most likely first
snags are Vercel's pnpm version (hence the corepack variable) and a missing
volume on Railway.

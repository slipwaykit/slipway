# Slipway backend. Build from the repository root:
#   docker build -f backend/Dockerfile -t slipway-backend .
# Works unchanged on Railway, Fly.io and Render.

FROM node:20-bookworm-slim AS base
ENV PNPM_HOME=/pnpm PATH=/pnpm:$PATH CI=true COREPACK_ENABLE_DOWNLOAD_PROMPT=0
RUN corepack enable
WORKDIR /app

FROM base AS build
# Only needed if better-sqlite3 has no prebuilt binary for the platform.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY packages ./packages
COPY backend ./backend
# The backend and the workspace packages it imports, nothing else: no frontend,
# no contracts, no root lint and test toolchain.
RUN pnpm install --frozen-lockfile --filter "backend..."
# Workspace packages resolve to their dist/ builds at runtime.
RUN pnpm --filter "backend^..." build

FROM base AS runtime
ENV NODE_ENV=production PORT=8787 SLIPWAY_DB_PATH=/data/slipway.db
COPY --from=build --chown=node:node /app /app
# SQLite lives on a mounted volume. Without one, history is lost on redeploy.
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8787)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
WORKDIR /app/backend
CMD ["node", "--import", "tsx", "src/index.ts"]

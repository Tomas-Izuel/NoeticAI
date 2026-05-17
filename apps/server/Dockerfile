# syntax=docker/dockerfile:1.7
# ---- 1) base: node + pnpm for the build ----
    FROM node:20-bookworm-slim AS base
    ENV PNPM_HOME=/pnpm
    ENV CI=true
    ENV PATH=$PNPM_HOME:$PATH
    RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
    WORKDIR /repo
    
    # ---- 2) fetch: warm pnpm store from lockfile only (best cache layer) ----
    FROM base AS fetch
    COPY pnpm-lock.yaml pnpm-workspace.yaml ./
    COPY package.json ./
    RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
        pnpm fetch
    
    # ---- 3) deps: install with offline store, full repo context ----
    FROM fetch AS deps
    ENV CI=true
    COPY . .
    RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
        pnpm install --offline --frozen-lockfile
    
    # ---- 4) prune: produce a self-contained, prod-only deploy folder ----
    FROM deps AS prune
    # pnpm deploy resolves workspace:* by copying real package contents into node_modules
    RUN pnpm --filter @noeticai/server deploy --prod --legacy /out
    
    # ---- 5) runtime: bun ----
    FROM oven/bun:1-slim AS runtime
    ENV NODE_ENV=production
    ENV PORT=8080
    WORKDIR /app
    # Non-root user (oven/bun:1-slim ships `bun` user uid 1000)
    COPY --from=prune --chown=bun:bun /out /app
    USER bun
    EXPOSE 8080
    HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
      CMD wget -qO- http://127.0.0.1:8080/health || exit 1
    CMD ["bun", "run", "src/index.ts"]
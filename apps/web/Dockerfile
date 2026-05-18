# syntax=docker/dockerfile:1.7
# ---- 1) base ----
    FROM node:20-bookworm-slim AS base
    ENV PNPM_HOME=/pnpm
    ENV CI=true
    ENV PATH=$PNPM_HOME:$PATH
    RUN corepack enable && corepack prepare pnpm@10.28.0 --activate
    WORKDIR /repo
    
    # ---- 2) fetch ----
    FROM base AS fetch
    COPY pnpm-lock.yaml pnpm-workspace.yaml ./
    COPY package.json ./
    RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
        pnpm fetch
    
    # ---- 3) deps ----
    FROM fetch AS deps
    ENV CI=true
    COPY . .
    RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
        pnpm install --offline --frozen-lockfile
    # ---- 4) build ----
    FROM deps AS build
    ARG VITE_API_BASE_URL
    ENV VITE_API_BASE_URL=${VITE_API_BASE_URL}
    RUN pnpm --filter @noeticai/web run build
    # Output: /repo/apps/web/dist
    
    # ---- 5) runtime: nginx ----
    FROM nginx:1.27-alpine AS runtime
    COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
    COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
    EXPOSE 80
    HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
      CMD wget -qO- http://127.0.0.1:80/ || exit 1
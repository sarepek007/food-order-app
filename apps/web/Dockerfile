FROM node:22-alpine AS build

RUN corepack enable pnpm
WORKDIR /app

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile --filter "@food/web..."

COPY packages/contracts ./packages/contracts
COPY apps/web ./apps/web
RUN pnpm --filter @food/contracts build && pnpm --filter @food/web build

# ---------------------------------------------------------------------
FROM nginx:1.27-alpine AS runtime

COPY --from=build /app/apps/web/dist /usr/share/nginx/html
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

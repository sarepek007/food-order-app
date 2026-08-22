# ---------------------------------------------------------------------
# Сборка: ставим зависимости только для API и его рабочего пространства
# ---------------------------------------------------------------------
FROM node:22-alpine AS build

RUN corepack enable pnpm
WORKDIR /app

# Манифесты копируются отдельно от исходников: слой с зависимостями
# переиспользуется, пока не изменился lock-файл.
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile --filter "@food/api..."

COPY packages/contracts ./packages/contracts
COPY apps/api ./apps/api
RUN pnpm --filter @food/contracts build && pnpm --filter @food/api build

# Отдельный каталог только с тем, что нужно в бою: production-зависимости
# и собранный код. Рабочее пространство целиком весило бы в разы больше.
#
# --legacy: без него pnpm требует inject-workspace-packages, а это меняет
# связывание пакетов и в разработке — рабочие копии перестают подхватываться
# без переустановки.
RUN pnpm deploy --legacy --filter "@food/api" --prod /deploy \
    && rm -rf /deploy/src /deploy/tests /deploy/scripts /deploy/coverage \
              /deploy/Dockerfile /deploy/requests.http /deploy/http-client.env.json

# ---------------------------------------------------------------------
# Запуск
# ---------------------------------------------------------------------
FROM node:22-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build --chown=node:node /deploy /app

USER node
EXPOSE 3000

# Миграции применяются самим приложением на старте: раннер идемпотентен
# и защищён advisory-локом от параллельного запуска реплик.
CMD ["node", "dist/main.js"]

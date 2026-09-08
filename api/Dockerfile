FROM node:22-slim AS base
WORKDIR /app

FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --legacy-peer-deps

FROM deps AS build
COPY . .
RUN npm run build

FROM base AS runtime
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
# src/ is needed at runtime too: migrations run via tsx directly against the
# TypeScript source (src/data-source.ts, src/entities, src/migrations), not
# the compiled output — see package.json's "migration:run" script.
# tsconfig.json must come along with it: without it, tsx/esbuild can't see
# `experimentalDecorators: true` and silently falls back to native stage-3
# decorator semantics, which TypeORM's legacy-style decorators choke on
# (fails with "Cannot read properties of undefined (reading 'constructor')").
COPY --from=build /app/src ./src
COPY tsconfig.json ./
COPY package.json ./

EXPOSE 3000
CMD ["sh", "-c", "npm run migration:run && node dist/main.js"]

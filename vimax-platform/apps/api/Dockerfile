FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/contracts/package.json ./packages/contracts/
COPY apps/api/package.json ./apps/api/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY . .
RUN pnpm --filter @vimax/contracts build
RUN pnpm --filter @vimax/api build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/apps/api/dist ./apps/api/dist
COPY --from=build /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=build /app/apps/api/package.json ./apps/api/
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/
COPY --from=build /app/node_modules ./node_modules
EXPOSE 3005
CMD ["node", "apps/api/dist/server.js"]

FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@9.15.0 --activate
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml* ./
COPY packages/contracts/package.json ./packages/contracts/
COPY packages/ui/package.json ./packages/ui/
COPY apps/api/package.json ./apps/api/
COPY apps/web/package.json ./apps/web/
RUN pnpm install --frozen-lockfile

FROM base AS build
# NEXT_PUBLIC_* 在构建期内联进客户端 bundle，必须作为 build args 传入。
ARG NEXT_PUBLIC_API_URL=http://localhost:3005/trpc
ARG NEXT_PUBLIC_DEFAULT_IMAGE_MODEL=cogview-3-flash
ARG NEXT_PUBLIC_DEFAULT_VIDEO_MODEL=cogvideox-flash
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} \
    NEXT_PUBLIC_DEFAULT_IMAGE_MODEL=${NEXT_PUBLIC_DEFAULT_IMAGE_MODEL} \
    NEXT_PUBLIC_DEFAULT_VIDEO_MODEL=${NEXT_PUBLIC_DEFAULT_VIDEO_MODEL}
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/contracts/node_modules ./packages/contracts/node_modules
COPY --from=deps /app/packages/ui/node_modules ./packages/ui/node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY --from=deps /app/apps/web/node_modules ./apps/web/node_modules
COPY . .
RUN pnpm --filter @vimax/contracts build
RUN pnpm --filter @vimax/web build

FROM node:22-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production HOSTNAME=0.0.0.0 PORT=3010
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
EXPOSE 3010
CMD ["node", "apps/web/server.js"]

#!/usr/bin/env bash
# ECS 端部署入口：CI 经 ssh 调用，也可手动执行（回滚 = 换旧镜像 tag 重跑）。
# 用法: bash scripts/deploy.sh <image-tag> [--migrate]
set -euo pipefail

IMAGE_TAG="${1:?usage: bash scripts/deploy.sh <image-tag> [--migrate]}"
MIGRATE="${2:-}"
cd "$(dirname "$0")/.."

export IMAGE_TAG
COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml"
APP_SERVICES="api web worker-image worker-video worker-concat worker-pipeline worker-audio"

$COMPOSE up -d postgres redis

if [ "$MIGRATE" = "--migrate" ]; then
  $COMPOSE --profile migrate run --rm migrate
fi

$COMPOSE pull $APP_SERVICES
$COMPOSE up -d --remove-orphans

HEALTHY=false
for _ in $(seq 1 30); do
  if $COMPOSE exec -T api wget -qO- http://127.0.0.1:3005/health >/dev/null 2>&1; then
    HEALTHY=true
    break
  fi
  sleep 2
done

if [ "$HEALTHY" = false ]; then
  $COMPOSE ps || true
  $COMPOSE logs --tail 80 api || true
  echo "deploy failed: api /health not ready within 60s (tag: $IMAGE_TAG)" >&2
  exit 1
fi

$COMPOSE ps
docker image prune -f
echo "deployed tag: $IMAGE_TAG"

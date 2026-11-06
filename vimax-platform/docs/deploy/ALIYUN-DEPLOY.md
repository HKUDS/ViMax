# 阿里云 ECS 部署（GitHub Actions → ACR → ECS）

## 一、历史踩坑总结

以下问题来自本仓库此前的部署实践，记录散落在 `docker-compose.yml`、三个 `Dockerfile` 与 `.dockerignore` 的注释及代码评审中。本次 CI/CD 方案逐条落实对策。

| # | 坑 | 现象 / 根因 | 本次对策 | 出处 |
|---|---|---|---|---|
| 1 | 国内构建环境拉包失败 | `pypi.org` / `deb.debian.org` 不可达，pip / apt 卡死 | Dockerfile 已内置清华镜像源（`UV_INDEX_URL` build-arg 可覆盖）；CI 构建放在 GitHub 海外 runner，出网无限制，镜像源作为 ECS 自建构建时的兜底 | `workers/image/Dockerfile` |
| 2 | `NEXT_PUBLIC_*` 运行时改环境变量无效 | Next.js 在 `next build` 时把 `NEXT_PUBLIC_*` 内联进客户端 bundle | 生产 API 地址在 CI 构建镜像时以 build args 注入（GitHub vars `NEXT_PUBLIC_API_URL` 等），改值必须重新构建并部署 web 镜像 | `apps/web/Dockerfile` |
| 3 | presigned URL 浏览器不可达 | API 签发的 S3 上传/下载 URL 直接发给浏览器 | 生产 `S3_ENDPOINT` 配 HTTPS 域名，由主机反向代理转发到 loopback 上的 MinIO 9000；不开放 9000 公网端口 | `docker-compose.prod.yml` |
| 4 | worker 运行时依赖宿主仓库源码 | 5 个 worker 均挂载 `..:/app/vimax:ro` 并设 `VIMAX_ROOT`，Python 框架（agents/tools/pipelines）不在镜像里 | CI 每次部署 rsync 整个仓库（含 Python 框架）到 ECS 固定路径，保持「vimax-platform 位于仓库根下」的相对结构不变 | `docker-compose.yml` worker 卷挂载 |
| 5 | Windows 宿主产物污染 | `node_modules` / `.next` / `dist` / `.venv` 含 Windows 二进制，打进镜像或同步上服务器即损坏 | `.dockerignore` 挡镜像；rsync 使用同款排除清单 | `.dockerignore` |
| 6 | 服务器上的 `.env` 被同步删掉 | 密钥只存在于服务器（不入库），`rsync --delete` 会将其删除，全部服务因缺配置瘫痪 | rsync `--exclude '.env'`（被排除的路径同时受删除保护），.env 只在服务器手工维护 | 本次新增 |
| 7 | DB schema 不随 compose 迁移 | compose 无迁移步骤，首次部署无表 api 直接起不来；schema 变更不生效 | `docker-compose.prod.yml` 增加 `migrate` profile 服务（node:22 容器内执行 `pnpm --filter @vimax/api db:push`），workflow 手动勾选触发；破坏性变更 drizzle-kit 会拒绝，需人工处理 | `apps/api/package.json` `db:push` |
| 8 | `API_PORT` 默认 3001 ≠ 容器映射 3005 | 默认端口与生产容器端口不同 | 生产 Compose 显式设置 `API_PORT=3005`，API 健康端点依赖数据库、Redis 与事件消费者就绪后才返回 200 | `apps/api/src/server.ts` |
| 9 | ECS 拉 Docker Hub 超时 | 国内拉 `postgres` / `redis` / `minio` 官方镜像经常超时失败 | ECS 配置阿里云容器镜像加速器（见下方一次性准备）；自建镜像全部走 ACR，不走 Docker Hub | 运维经验 |
| 10 | 基础服务弱口令暴露公网 | base compose 的开发口令不适用于生产 | prod override 强制设置数据库、MinIO、应用 S3、邀请口令；Postgres/Redis 不映射宿主端口，HTTP 服务仅绑定 loopback | `docker-compose.prod.yml` |
| 11 | 中文字幕 / 压字乱码 | 容器缺 CJK 字体，ffmpeg 烧录字幕为方块 | 镜像已内置 `fonts-noto-cjk`；`SUBTITLE_FONT` 可覆盖 | `workers/image/Dockerfile` |
| 12 | 无多租户隔离 | tRPC 只验证登录态，资源级授权与租户传播缺失（代码评审结论） | 公网部署定位仅限**可信单团队共享空间**；对外开放前必须补服务端资源授权 | `docs/reviews/2026-10-28-generation-harness-review.md` |

## 二、部署架构

```
git push main / 手动触发
        │
        ▼
GitHub Actions（海外 runner，出网无限制）
  1. 构建镜像 ×5：vimax-api / vimax-web / vimax-worker / vimax-worker-ffmpeg / vimax-worker-agents
     （tag = commit sha + latest；web 构建注入 NEXT_PUBLIC_*；buildx gha 缓存）
  2. 推送阿里云 ACR（个人版免费）
  3. rsync 仓库源码 → ECS（worker 的 VIMAX_ROOT 依赖；排除产物与 .env）
  4. ssh 调用服务器上的 scripts/deploy.sh
        │
        ▼
ECS（docker compose -f docker-compose.yml -f docker-compose.prod.yml）
  pull 自建镜像 → （首次部署/数据库变更时 --migrate）→ up -d → /health 探活 → 镜像清理
```

worker 镜像与服务的对应（三变体同一 Dockerfile，不同 build args，与 base compose 保持一致）：

| 镜像 | 构建参数 | 服务 |
|---|---|---|
| `vimax-worker` | — | worker-image、worker-audio |
| `vimax-worker-ffmpeg` | `INSTALL_FFMPEG=true` | worker-video、worker-concat |
| `vimax-worker-agents` | `INSTALL_VIMAX_AGENTS=true` | worker-pipeline |

## 三、一次性准备

### 1. 阿里云 ACR

1. 开通「容器镜像服务 - 个人版」（免费），记录 `registry.cn-<地域>.aliyuncs.com` 与命名空间。
2. 访问凭证：控制台 → 访问凭证 → 设置固定密码（即 ACR_PASSWORD）。
3. 在命名空间下创建 5 个**私有**仓库：`vimax-api`、`vimax-web`、`vimax-worker`、`vimax-worker-ffmpeg`、`vimax-worker-agents`（或开启「自动创建仓库」）。

### 2. ECS 初始化

```bash
# docker + compose（compose >= 2.24，prod 文件用了 ports: !override）
curl -fsSL https://get.docker.com | sh
docker compose version   # 确认 >= 2.24

# Docker Hub 加速器（坑 #9）：ECS 控制台复制个人加速器地址后
sudo tee /etc/docker/daemon.json <<'EOF'
{ "registry-mirrors": ["https://<你的加速器地址>"] }
EOF
sudo systemctl restart docker

# 部署目录（与 GitHub vars.DEPLOY_PATH 一致）
mkdir -p /opt/vimax
```

安全组只放行：`22`（SSH）、`80` / `443`（TLS 反向代理）。反向代理将 Web、API、对象存储域名分别转发到 `127.0.0.1:3010`、`127.0.0.1:3005`、`127.0.0.1:9000`。
**不要**放行 3005 / 3010 / 9000 / 5432 / 6379 / 9001；这些端口仅供本机反向代理或 Docker 网络使用。

### 3. GitHub 仓库配置

| 类型 | 名称 | 示例 / 说明 |
|---|---|---|
| Secret | `ACR_REGISTRY` | `registry.cn-hangzhou.aliyuncs.com` |
| Secret | `ACR_NAMESPACE` | ACR 命名空间 |
| Secret | `ACR_USERNAME` | ACR 用户名（一般是阿里云账号 ID） |
| Secret | `ACR_PASSWORD` | ACR 固定密码 |
| Secret | `ALIYUN_SSH_HOST` | ECS 公网 IP |
| Secret | `ALIYUN_SSH_PORT` | SSH 端口（可省略，默认 22） |
| Secret | `ALIYUN_SSH_USER` | `root` 或部署用户（需有 docker 与 DEPLOY_PATH 写权限） |
| Secret | `ALIYUN_SSH_KEY` | SSH 私钥全文（对应公钥放入 ECS `~/.ssh/authorized_keys`） |
| Variable | `DEPLOY_PATH` | `/opt/vimax`（可省略，默认即此值） |
| Variable | `NEXT_PUBLIC_API_URL` | `https://api.<域名>/trpc`（必配，CI 校验 HTTPS） |
| Variable | `NEXT_PUBLIC_DEFAULT_IMAGE_MODEL` | 可省略，默认 `cogview-3-flash` |
| Variable | `NEXT_PUBLIC_DEFAULT_VIDEO_MODEL` | 可省略，默认 `cogvideox-flash` |

### 4. 服务器 `.env`

写入 `/opt/vimax/vimax-platform/.env`（rsync 不覆盖此文件，坑 #6）。以 `.env.example` 为底，重点改以下项：

```ini
# ── 基础设施（compose 网络内地址，api 的 environment 会覆盖为容器地址）──
DATABASE_URL=postgres://vimax:<强口令>@postgres:5432/vimax
REDIS_URL=redis://redis:6379

# ── 对象存储：endpoint 必须 HTTPS 浏览器可达，反代至 127.0.0.1:9000 ──
S3_ENDPOINT=https://assets.<域名>
S3_BUCKET=vimax-assets
S3_ACCESS_KEY=<独立应用账号>
S3_SECRET_KEY=<独立应用密钥>
S3_REGION=us-east-1
S3_FORCE_PATH_STYLE=true

# ── API ──
API_PORT=3005
API_HOST=0.0.0.0
JWT_SECRET=<至少 32 字符随机串>
REGISTRATION_INVITE_CODE=<仅发给团队成员的随机邀请码>
CORS_ORIGINS=https://<Web 域名>

# ── 模型 Key：照 .env.example 填 ──
ARK_API_KEY=...
ZHIPU_API_KEY=...

# ── 生产部署追加（docker-compose.prod.yml 镜像插值 + 基础服务口令，坑 #10）──
ACR_REGISTRY=registry.cn-hangzhou.aliyuncs.com
ACR_NAMESPACE=<命名空间>
IMAGE_TAG=<commit SHA>
POSTGRES_USER=vimax
POSTGRES_PASSWORD=<强口令>
MINIO_ROOT_USER=<独立 MinIO 管理员>
MINIO_ROOT_PASSWORD=<强口令>
```

## 四、日常操作

```bash
# 触发部署：push 到 main；首次部署或数据库 schema 有变更时，在 Actions 页面 Run workflow 并勾选 migrate
# 手动补一次部署 / 指定版本（服务器上）：
bash /opt/vimax/vimax-platform/scripts/deploy.sh <commit-sha>

# 回滚：deploy.sh 换旧 tag 即可（镜像都在 ACR）
bash /opt/vimax/vimax-platform/scripts/deploy.sh <旧commit-sha> 

# 仅迁移 schema：
cd /opt/vimax/vimax-platform
docker compose -f docker-compose.yml -f docker-compose.prod.yml --profile migrate run --rm migrate

# 看日志 / 状态：
docker compose -f docker-compose.yml -f docker-compose.prod.yml logs -f --tail 200 api
docker compose -f docker-compose.yml -f docker-compose.prod.yml ps
```

注意：drizzle-kit `db:push` 对非破坏性变更（加表/加列）静默应用；涉及删列/改类型时在非交互环境直接失败，需开发者本地评估后手动处理。

## 五、上线前安全须知

- 当前定位为**可信单团队共享空间**（坑 #12）：任何拿到账号的人可见全部画布资源。对外开放注册前必须补资源级授权与租户传播。
- 必须在 ECS 配置 Nginx/Caddy 等 TLS 反向代理，为 Web、API、对象存储分别配置域名；Web 镜像须以 `https://api.<域名>/trpc` 重建。
- 首次注册需团队邀请码。当前仍是可信单团队共享空间，获得邀请的账号可访问共享画布；公开 SaaS 前仍须补资源级授权与租户传播。
- JWT_SECRET、各模型 API Key 均只在服务器 `.env`，不进仓库、不进镜像层、不进 GitHub。

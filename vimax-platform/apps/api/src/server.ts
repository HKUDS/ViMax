import "dotenv/config";
import { createServer } from "node:http";
import { serve } from "@hono/node-server";
import { trpcServer } from "@hono/trpc-server";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { config } from "./config/env.js";
import { getDb } from "./infrastructure/db/client.js";
import { startAllBridgeWorkers } from "./infrastructure/queue/bullmq.js";
import { startJobEventConsumer } from "./infrastructure/pubsub/consumer.js";
import { jobSseHandler } from "./realtime/job-sse.route.js";
import { createWebSocketServer, handleUpgrade } from "./realtime/websocket.js";
import { initVendorRegistry } from "./domain/vendor/vendor-registry.js";
import { initSkillRegistry } from "./domain/skill/skill-registry.js";
import { seedModels } from "./domain/model/model.service.js";
import { sweepGeneratedAssets } from "./domain/asset/asset-offload.js";
import { sweepStalledJobs } from "./domain/job/job-stall.js";
import { appRouter } from "./trpc/router.js";
import { createContext } from "./trpc/trpc.js";

const app = new Hono();

app.use(
  "*",
  cors({
    origin: ["http://localhost:3000", "http://127.0.0.1:3000", "http://localhost:3010", "http://127.0.0.1:3010"],
    allowMethods: ["GET", "POST", "OPTIONS"],
  }),
);

app.get("/health", (c) => c.json({ ok: true, service: "vimax-api" }));

app.get("/sse/jobs/:jobId", jobSseHandler);

app.use(
  "/trpc/*",
  trpcServer({
    router: appRouter,
    createContext: (opts) => createContext(opts),
  }),
);

const port = config.apiPort();
const host = config.apiHost();

async function bootstrap() {
  try {
    getDb();
    console.log("Database connection initialized");

    // Seed default models if table is empty
    try {
      const seeded = await seedModels();
      if (seeded > 0) console.log(`Seeded ${seeded} default models`);
    } catch (err) {
      console.warn("Model seeding skipped:", (err as Error).message);
    }
  } catch (err) {
    console.warn("Database not connected yet:", (err as Error).message);
  }

  try {
    startAllBridgeWorkers();
    console.log("BullMQ bridge workers started (image/video/concat/audio/pipeline)");
  } catch (err) {
    console.warn("BullMQ bridge workers not started:", (err as Error).message);
  }

  try {
    await startJobEventConsumer();
  } catch (err) {
    console.warn("Job event consumer not started:", (err as Error).message);
  }

  // Create WebSocket server
  createWebSocketServer();

  // Initialize vendor plugin system
  initVendorRegistry();

  // Initialize skill system
  initSkillRegistry();

  // ── 本地化存储 TTL 清扫 ──────────────────────────────────────
  // 未被客户端认领的 generated 资产二进制超过 TTL 后删除（元数据行保留）。
  // 每 6 小时跑一轮；ASSET_SWEEP_TTL_HOURS=0 可关闭。
  const sweepTtlHours = config.assetSweepTtlHours();
  if (sweepTtlHours > 0) {
    const runSweep = async () => {
      try {
        const { swept } = await sweepGeneratedAssets(sweepTtlHours);
        if (swept > 0) console.log(`[asset-sweep] offloaded ${swept} stale generated assets`);
      } catch (err) {
        console.warn("[asset-sweep] failed:", (err as Error).message);
      }
    };
    const sweepTimer = setInterval(() => void runSweep(), 6 * 3600 * 1000);
    sweepTimer.unref();
    // 启动后延迟 2 分钟跑首轮，避开启动高峰
    const firstRun = setTimeout(() => void runSweep(), 2 * 60 * 1000);
    firstRun.unref();
  }

  // ── 僵尸任务清扫 ─────────────────────────────────────────────
  // worker/宿主崩溃遗留的 queued/running 任务超过阈值后标记失败并同步
  // 节点状态，释放节点的在途锁让重试可行。每 15 分钟跑一轮。
  const runStallSweep = async () => {
    try {
      const { swept } = await sweepStalledJobs();
      if (swept > 0) console.log(`[job-stall] marked ${swept} stalled jobs as failed`);
    } catch (err) {
      console.warn("[job-stall] failed:", (err as Error).message);
    }
  };
  const stallTimer = setInterval(() => void runStallSweep(), 15 * 60 * 1000);
  stallTimer.unref();
  const stallFirst = setTimeout(() => void runStallSweep(), 60 * 1000);
  stallFirst.unref();

  // Start Hono HTTP server — serve() returns the underlying http.Server
  const httpServer = serve({ fetch: app.fetch, port, hostname: host }, (info) => {
    console.log(`ViMax API listening on http://${info.address}:${info.port}`);
    console.log(`SSE endpoint: http://${info.address}:${info.port}/sse/jobs/:jobId`);
    console.log(`WebSocket endpoint: ws://${info.address}:${info.port}/ws`);
  });

  // Handle WebSocket upgrades on the same HTTP server
  httpServer.on("upgrade", (req, socket, head) => {
    handleUpgrade(req, socket, head);
  });
}

bootstrap();

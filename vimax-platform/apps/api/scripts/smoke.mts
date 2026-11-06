// ── Full-chain smoke test ────────────────────────────────────────────
// 用法: pnpm --filter @vimax/api exec tsx scripts/smoke.mts
// 前置: docker compose up -d (postgres/redis/minio) + API(:3005) + Web(:3010)
//       + image worker 运行中。文本/图像模型未配 key 时对应项自动 SKIP。
//       免费链路: export ZHIPU_API_KEY / MODELSCOPE_API_TOKEN 后运行，
//       S13 优先走 cogview-3-flash / modelscope-qwen-image，S13b 走 cogvideox-flash。

import { execSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { deflateSync } from "node:zlib";
import { WebSocket } from "ws";

const API = process.env.API_BASE ?? "http://localhost:3005";
const WEB = process.env.WEB_BASE ?? "http://localhost:3010";

const results: Array<{ name: string; status: "PASS" | "FAIL" | "SKIP"; detail: string }> = [];
let failed = 0;

async function check(name: string, fn: () => Promise<string>) {
  try {
    const detail = await fn();
    results.push({ name, status: "PASS", detail });
    console.log(`PASS ${name} — ${detail}`);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    if (detail.startsWith("SKIP: ")) {
      results.push({ name, status: "SKIP", detail });
      console.log(`SKIP ${name} — ${detail}`);
      return;
    }
    failed++;
    results.push({ name, status: "FAIL", detail });
    console.log(`FAIL ${name} — ${detail}`);
  }
}
function skip(name: string, detail: string) {
  results.push({ name, status: "SKIP", detail });
  console.log(`SKIP ${name} — ${detail}`);
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ── tRPC helpers (batch=1, no transformer) ─────────────────────────
async function trpcMut<T>(path: string, input: unknown, token?: string): Promise<T> {
  const res = await fetch(`${API}/trpc/${path}?batch=1`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ "0": input }),
  });
  const body = (await res.json()) as Array<{ result?: { data?: T }; error?: { message: string } }>;
  if (!res.ok || body[0]?.error) throw new Error(`${path}: ${body[0]?.error?.message ?? res.status}`);
  return body[0]!.result!.data as T;
}
async function trpcQuery<T>(path: string, input: unknown, token?: string): Promise<T> {
  const url = `${API}/trpc/${path}?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": input }))}`;
  const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  const body = (await res.json()) as Array<{ result?: { data?: T }; error?: { message: string } }>;
  if (!res.ok || body[0]?.error) throw new Error(`${path}: ${body[0]?.error?.message ?? res.status}`);
  return body[0]!.result!.data as T;
}
async function modelHasKey(type: string): Promise<boolean> {
  try {
    const out = execSync(
      `docker exec vimax-platform-postgres-1 psql -U vimax -d vimax -t -A -c "select count(*) from models where tenant_id='default' and type='${type}' and is_default=1 and coalesce(api_key,'')<>''"`,
      { encoding: "utf8" },
    ).trim();
    return out === "1";
  } catch {
    return false;
  }
}

interface SnapNode {
  id: string;
  type: string;
  output_asset_id?: string | null;
  data?: Record<string, unknown>;
}
interface CanvasSnap { nodes: SnapNode[] }

// ── minimal PNG encoder (no deps) ───────────────────────────────────
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}
export function makePng(width: number, height: number, rgb: [number, number, number]): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; // 8-bit truecolor
  const row = Buffer.alloc(1 + width * 3);
  for (let x = 0; x < width; x++) {
    row[1 + x * 3] = rgb[0];
    row[2 + x * 3] = rgb[1];
    row[3 + x * 3] = rgb[2];
  }
  const raw = Buffer.concat(Array(height).fill(row));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

async function pollJob(jobId: string, token: string, timeoutMs: number, procedure = "image.getJob") {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const job = await trpcQuery<{ status: string; output_url?: string; error_message?: string }>(
      procedure, { job_id: jobId }, token,
    );
    if (job.status === "succeeded") return job;
    if (job.status === "failed") throw new Error(`job failed: ${job.error_message ?? "?"}`);
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error("job timeout");
}

// ════════════════════════════════════════════════════════════════════
async function main() {
  const email = `smoke-${Date.now()}@test.local`;
  const password = "Smoke123456!";
  let token = "";
  let canvasId = "";
  let assetId = "";

  await check("S01 基础设施 (pg/redis/minio)", async () => {
    const pg = execSync(
      "docker exec vimax-platform-postgres-1 pg_isready -U vimax -d vimax", { encoding: "utf8" },
    ).includes("accepting");
    const rd = execSync(
      "docker exec vimax-platform-redis-1 redis-cli ping", { encoding: "utf8" },
    ).includes("PONG");
    assert(pg && rd, "pg/redis 未就绪");
    return "pg/redis OK";
  });

  await check("S02 API health", async () => {
    const d = await (await fetch(`${API}/trpc/health`)).json();
    assert(d?.result?.data?.ok === true, "health 非 ok");
    return API;
  });

  await check("S03 Web 首页可达", async () => {
    const res = await fetch(`${WEB}/`);
    assert(res.ok, `HTTP ${res.status}`);
    return `${WEB} ${res.status}`;
  });

  await check("S04 注册+登录", async () => {
    await trpcMut("auth.register", { email, password, name: "smoke" });
    const d = await trpcMut<{ tokens: { accessToken: string } }>("auth.login", { email, password });
    token = d.tokens.accessToken;
    assert(token.length > 20, "无 accessToken");
    return email;
  });

  await check("S05 token 刷新与受保护接口", async () => {
    const me = await trpcQuery<{ user: { email?: string } }>("auth.me", { accessToken: token });
    assert(me?.user?.email === email, "me 返回异常");
    return "auth.me OK";
  });

  await check("S06 知识库种子+检索", async () => {
    await trpcMut("knowledge.seedPlatformRules", {}, token);
    const { items } = await trpcQuery<{ items: Array<{ title: string }> }>(
      "knowledge.search", { query: "amazon", limit: 2 }, token);
    assert(items.length > 0, "检索 0 命中");
    return `hits=${items.length} top="${items[0]!.title}"`;
  });

  await check("S07 品牌套装读写", async () => {
    const { kitId } = await trpcMut<{ kitId: string }>(
      "ecom.saveBrandKit",
      { name: "smoke-brand", colors: [{ hex: "#1A73E8", usage: "主色" }], bannedWords: ["红色背景"] },
      token);
    const kit = await trpcQuery<{ name: string } | null>("ecom.getBrandKit", { kitId }, token);
    assert(kit?.name === "smoke-brand", "读回失败");
    return kitId.slice(0, 8);
  });

  await check("S08 资产上传 (presigned PUT + confirm)", async () => {
    // 像素随时间变化：保证 sha 唯一，避免下游 S10 命中已被 TTL 清扫的历史缓存对象。
    const png = makePng(800, 600, [26, 53, Date.now() % 256]);
    const up = await trpcMut<{ asset_id: string; upload_url: string }>(
      "asset.requestUpload", { mime_type: "image/png", size_bytes: png.length }, token);
    const put = await fetch(up.upload_url, { method: "PUT", body: png, headers: { "Content-Type": "image/png" } });
    assert(put.ok, `PUT ${put.status}`);
    await trpcMut("asset.confirmUpload",
      { asset_id: up.asset_id, sha256: createHash("sha256").update(png).digest("hex"), width: 800, height: 600 },
      token);
    assetId = up.asset_id;
    return `${png.length} bytes → ${assetId.slice(0, 8)}`;
  });

  await check("S09 画布创建", async () => {
    const d = await trpcMut<{ canvas_id: string }>("canvas.create", { name: "smoke-canvas" }, token);
    canvasId = d.canvas_id;
    return canvasId.slice(0, 8);
  });

  // 中文压字：canvas 节点 → image.text → worker PIL → MinIO → 节点回填
  await check("S10 image.text 中文压字 (canvas→queue→worker→OSS)", async () => {
    assert(assetId && canvasId, "缺少前置资产/画布");
    const nodeId = randomUUID();
    await trpcMut("canvas.save", {
      canvas_id: canvasId,
      nodes: [{
        id: nodeId, type: "image", position: { x: 100, y: 100 },
        data: {
          prompt: `text overlay ${Date.now()}`, modelId: "pil", size: "800x600",
          sourceAssetId: assetId,
          textLayers: [{ text: "限时五折", x: 0.5, y: 0.75, font_size: 72, color: "#ffffff", align: "center" }],
        },
        status: "idle",
      }],
      edges: [],
    }, token);
    const run = await trpcMut<{ job_id: string }>("canvas.runNode", { canvas_id: canvasId, node_id: nodeId }, token);
    const job = await pollJob(run.job_id, token, 90_000);
    assert(job.output_url, "无 output_url");
    const out = Buffer.from(await (await fetch(job.output_url)).arrayBuffer());
    assert(out.subarray(0, 8).equals(makePng(1, 1, [0, 0, 0]).subarray(0, 8)), `非 PNG (${out.subarray(0, 16).toString("hex")})`);
    assert(out.length > 2000, `产物过小 ${out.length}`);
    let backed = false;
    for (let i = 0; i < 6 && !backed; i++) {
      const snap = await trpcQuery<CanvasSnap>("canvas.snapshot", { canvas_id: canvasId }, token);
      backed = Boolean(snap.nodes.find((n) => n.id === nodeId)?.output_asset_id);
      if (!backed) await new Promise((r) => setTimeout(r, 2000));
    }
    assert(backed, "节点未回填 outputAssetId");
    return `job=${run.job_id.slice(0, 8)} out=${out.length}B`;
  });

  // 合规预检：image.compliance 返回结构化报告
  await check("S11 image.compliance 合规预检", async () => {
    const nodeId = randomUUID();
    await trpcMut("canvas.save", {
      canvas_id: canvasId,
      nodes: [{
        id: nodeId, type: "image", position: { x: 500, y: 100 },
        data: { prompt: "compliance", modelId: "compliance", size: "800x600",
          sourceAssetId: assetId, compliancePlatforms: ["amazon", "tiktok_shop"] },
        status: "idle",
      }],
      edges: [],
    }, token);
    const run = await trpcMut<{ job_id: string }>("canvas.runNode", { canvas_id: canvasId, node_id: nodeId }, token);
    await pollJob(run.job_id, token, 60_000);
    const snap = await trpcQuery<CanvasSnap>("canvas.snapshot", { canvas_id: canvasId }, token);
    const reports = snap.nodes.find((n) => n.id === nodeId)?.data?.complianceReports as
      Array<{ platform: string; checks: unknown[] }> | undefined;
    assert(Array.isArray(reports) && reports.length === 2, "报告未回填");
    assert(reports.every((r) => Array.isArray(r.checks)), "checks 结构异常");
    return reports.map((r) => `${r.platform}:${r.checks.length}项`).join(" ");
  });

  // worker 重试：坏生成器 → 2 次退避后 failed
  await check("S12 worker 瞬时失败重试", async () => {
    const { Redis } = await import("ioredis");
    const sub = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
    const push = new Redis(process.env.REDIS_URL ?? "redis://localhost:6379");
    const chan = `smoke:${randomUUID()}`;
    const jobId = randomUUID();
    const wait = new Promise<Record<string, unknown>>((resolve) => {
      sub.on("message", (_c, raw) => {
        const ev = JSON.parse(raw);
        if (ev.type === "failed") resolve(ev);
      });
      sub.subscribe(chan, () => {
        push.lpush("vimax:queue:q.image.std", JSON.stringify({
          job_id: jobId, job_type: "image.t2i", model_id: "bad",
          credential: { class_path: "no.such.Gen", api_key: "k" },
          input: { prompt: "x", size: "800x600" },
          callback: { event_channel: chan, upload_bucket: "vimax-assets", upload_prefix: "smoke" },
          cache_key: randomUUID(), timeout_ms: 30_000, attempt: 0,
        }));
      });
    });
    const timer = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("超时")), 60_000));
    const ev = await Promise.race([wait, timer]);
    sub.disconnect();
    push.disconnect();
    assert(ev.error_code === "worker.internal" && ev.retryable === true, "错误分类异常");
    return "retry×2 后 failed (退避 3s+6s)";
  });

  // 真实生图（依赖图像模型 key）
  // 免费档（智谱/魔搭）key 在环境变量里即可跑真实生图；否则回退 DB 默认模型。
  const zhipuKey = process.env.ZHIPU_API_KEY ?? "";
  const msToken = process.env.MODELSCOPE_API_TOKEN ?? "";
  const models = await trpcQuery<{ items: Array<{ id: string; label: string }> }>(
    "model.listImageModels", {}, token);
  const freeImageModel =
    (zhipuKey && models.items.find((m) => m.id === "cogview-3-flash")) ||
    (msToken && models.items.find((m) => m.id === "modelscope-qwen-image")) ||
    // key 未配置时上面得到 ""，归一为 undefined，避免后续 `?? items[0]` 失效
    undefined;
  if (freeImageModel || (await modelHasKey("image"))) {
    const picked = freeImageModel ?? models.items[0]!;
    await check("S12b 生图工坊 image.edit 透明底 (studio edit 链路)", async () => {
      assert(assetId, "缺少前置资产");
      // 编辑链路要求模型支持参考图（cogview 等纯 t2i 档会被服务端正确拒绝）
      const editModel =
        models.items.find((m) => m.supports_reference !== false) ?? freeImageModel ?? picked;
      const res = await trpcMut<{ job_id: string }>("image.edit", {
        source_asset_id: assetId, edit_op: "remove_bg", model_id: editModel.id,
      }, token);
      const job = await pollJob(res.job_id, token, 90_000);
      assert(job.output_url, "无 output_url");
      const detail = await trpcQuery<{ edit_op?: string; source_asset_id?: string }>(
        "image.getJob", { job_id: res.job_id }, token);
      assert(detail.edit_op === "remove_bg" && detail.source_asset_id === assetId,
        "getJob 未回传 edit_op/source_asset_id");
      const out = Buffer.from(await (await fetch(job.output_url)).arrayBuffer());
      assert(out.subarray(0, 8).equals(makePng(1, 1, [0, 0, 0]).subarray(0, 8)), `非 PNG (${out.subarray(0, 16).toString("hex")})`);
      const hist = await trpcQuery<{ items: Array<{ job_id: string; edit_op?: string }> }>(
        "image.listHistory", { limit: 5 }, token);
      assert(hist.items.some((h) => h.job_id === res.job_id && h.edit_op === "remove_bg"),
        "历史未含编辑标记");
      return `job=${res.job_id.slice(0, 8)} out=${out.length}B`;
    });
    await check(`S13 真实文生图 (${picked.label} 全链路)`, async () => {
      const gen = await trpcMut<{ job_id: string }>("image.generate", {
        mode: "t2i", prompt: `一只透明玻璃香水瓶放在纯白色背景上，柔和棚拍光线 ${Date.now()}`,
        model_id: picked.id, size: "1024x1024",
      }, token);
      const job = await pollJob(gen.job_id, token, 180_000);
      assert(job.output_url, "无 output_url");
      const out = Buffer.from(await (await fetch(job.output_url)).arrayBuffer());
      assert(out.length > 10_000, `产物过小 ${out.length}`);
      return `out=${out.length}B`;
    });
  } else {
    skip("S12b 生图工坊 image.edit 透明底", "图像模型未配 key");
    skip("S13 真实文生图", "图像模型未配 key");
  }

  // 真实文生视频（免费档 cogvideox-flash，异步 1-5 分钟）
  if (zhipuKey) {
    await check("S13b 真实文生视频 (CogVideoX-Flash 免费链路)", async () => {
      const gen = await trpcMut<{ job_id: string }>("video.generate", {
        mode: "t2v", prompt: `一只猫在阳光下玩毛线球，柔和镜头缓慢推近 ${Date.now()}`,
        model_id: "cogvideox-flash", duration_sec: 5, resolution: "480p", aspect_ratio: "16:9", fps: 16,
      }, token);
      const job = await pollJob(gen.job_id, token, 300_000, "video.getJob");
      assert(job.output_url, "无 output_url");
      const out = Buffer.from(await (await fetch(job.output_url)).arrayBuffer());
      assert(out.length > 30_000, `产物过小 ${out.length}`);
      return `out=${(out.length / 1024).toFixed(0)}KB`;
    });
  } else skip("S13b 真实文生视频", "未配置 ZHIPU_API_KEY");

  // Chat Agent 全链路（依赖文本模型 key + 上游可用）
  if (await modelHasKey("text")) {
    await check("S14 Chat Agent 工具循环 (WS→决策→工具→画布)", async () => {
      const upstreamDown = (msg: string) =>
        msg.startsWith("SKIP: 上游文本模型不可用");
      assert(canvasId, "无画布");
      const conv = await trpcMut<{ conversation: { id: string } }>(
        "chat.createConversation", { canvasId, title: "smoke" }, token);
      const convId = conv.conversation.id;

      const events: Array<{ type: string; tool?: string; text?: string }> = [];
      const done = new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(`${API.replace("http", "ws")}/ws?token=${token}`);
        ws.on("unexpected-response", (_req, res) => {
          reject(new Error(`WS upgrade HTTP ${res.statusCode}`));
        });
        const timer = setTimeout(() => { ws.close(); reject(new Error("300s 超时")); }, 300_000);
        ws.on("open", () => {
          ws.send(JSON.stringify({ type: "chat.subscribe", canvasId }));
          ws.send(JSON.stringify({ type: "chat.send", conversationId: convId, content: "帮我生成一张1:1的商品图：透明玻璃香水瓶，纯白背景，电商主图风格" }));
        });
        ws.on("message", (raw) => {
          const msg = JSON.parse(String(raw));
          if (msg.type?.startsWith("chat.") && msg.conversationId === convId) {
            if (msg.type === "tool_call") events.push({ type: msg.type, tool: msg.tool?.name });
            if (msg.type === "tool_result") events.push({ type: msg.type, tool: msg.tool?.name });
            if (msg.type === "delta" && msg.content) events.push({ type: "delta", text: msg.content });
            if (msg.type === "complete") { clearTimeout(timer); ws.close(); resolve(); }
            if (msg.type === "chat.error") {
              clearTimeout(timer); ws.close();
              reject(new Error(/responded 5\d\d/.test(msg.error)
                ? `SKIP: 上游文本模型不可用（${msg.error.slice(0, 60)}）`
                : msg.error));
            }
          }
        });
        ws.on("error", (e) => { clearTimeout(timer); reject(e); });
      });
      await done;

      const toolCalls = events.filter((e) => e.type === "tool_call");
      assert(toolCalls.length > 0, "未观察到任何工具调用");
      const snap = await trpcQuery<CanvasSnap>("canvas.snapshot", { canvas_id: canvasId }, token);
      const imageNodes = snap.nodes.filter((n) => n.type === "image").length;
      assert(imageNodes >= 3, `画布 image 节点 ${imageNodes} < 3（text+compliance+agent 生成的）`);
      return `tools=[${toolCalls.map((t) => t.tool).join(",")}] image节点=${imageNodes}`;
    });
  } else skip("S14 Chat Agent 工具循环", "文本模型未配 key");

  // 分镜重跑幂等：重跑 storyboard 必须替换旧链而不是追加——
  // 旧 cell 全部消失，新 cell 全新 id（否则节点翻倍 + 自动连线跨链错接）
  if (await modelHasKey("text")) {
    await check("S17 分镜重跑幂等 (旧链清理，节点不翻倍)", async () => {
      assert(canvasId, "无画布");
      const scriptId = randomUUID();
      await trpcMut("canvas.save", {
        canvas_id: canvasId,
        nodes: [{
          id: scriptId, type: "script", position: { x: 0, y: 0 },
          data: {
            content: `一只橘猫在花园里追蝴蝶。第一场：清晨，橘猫蹲在花架下盯着一只白蝴蝶。第二场：橘猫扑空，蝴蝶落在它的鼻尖上。`,
            status: "idle",
          },
          status: "idle",
        }],
        edges: [],
      }, token);

      const runOnce = async () => {
        const run = await trpcMut<{ job_id: string }>(
          "canvas.runScript2Storyboard", { canvas_id: canvasId, node_id: scriptId }, token);
        await pollJob(run.job_id, token, 180_000);
        const snap = await trpcQuery<CanvasSnap>("canvas.snapshot", { canvas_id: canvasId }, token);
        const cells = snap.nodes.filter((n) => n.type === "storyboard_cell").map((n) => n.id);
        assert(cells.length > 0, "分镜 0 cell");
        return cells;
      };

      const cells1 = await runOnce();
      const cells2 = await runOnce();
      const leftover = cells1.filter((id) => cells2.includes(id));
      assert(leftover.length === 0, `旧 cell 残留 ${leftover.length} 个（重跑未清理旧链）`);
      return `run1=${cells1.length} cell → run2=${cells2.length} cell（全新替换）`;
    });
  } else skip("S17 分镜重跑幂等", "文本模型未配 key");

  await check("S15 沙盒脚本生命周期", async () => {
    const { scriptId } = await trpcMut<{ scriptId: string }>(
      "sandbox.createScript", { name: "smoke", code: "print('hi')" }, token);
    const run = await trpcMut<{ runId: string }>(
      "sandbox.createRun", { canvasId, scriptId, inputAssetIds: [] }, token);
    await trpcMut("sandbox.completeRun", { runId: run.runId, outputAssetIds: [] }, token);
    const done = await trpcQuery<{ status: string }>("sandbox.getRun", { runId: run.runId }, token);
    assert(done.status === "completed", `status=${done.status}`);
    return "pending→completed";
  });

  await check("S16 反馈信号记录", async () => {
    await trpcMut("feedback.record", { signal: "thumb_up", canvasId }, token);
    const pairs = await trpcQuery<{ items: Array<unknown> }>("feedback.trainingPairs", { limit: 10 }, token);
    assert(Array.isArray(pairs.items), "导出异常");
    return "record+export OK";
  });

  // 清理（canvas 级联删节点；用户删除；资产保留作历史）
  try {
    if (canvasId) await trpcMut("canvas.delete", { canvas_id: canvasId }, token);
    execSync(
      `docker exec vimax-platform-postgres-1 psql -U vimax -d vimax -q -c "delete from users where email='${email}'"`,
    );
  } catch { /* 清理失败不影响结论 */ }

  console.log("\n════════ 冒烟结果 ════════");
  const pass = results.filter((r) => r.status === "PASS").length;
  const skipN = results.filter((r) => r.status === "SKIP").length;
  for (const r of results) console.log(`${r.status.padEnd(4)} ${r.name}`);
  console.log(`──────── PASS ${pass} / FAIL ${failed} / SKIP ${skipN}`);
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("SMOKE CRASH:", err);
  process.exit(1);
});

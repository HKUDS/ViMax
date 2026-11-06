// 端到端验证：创意(剧本) → 全自动管线 → 合成视频
import { WebSocket } from "ws";
import postgres from "postgres";

const API = "http://localhost:3005";
const j = async (path: string, body: unknown, token?: string) =>
  (await fetch(`${API}/trpc/${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  }).then((r) => r.json())).result?.data;

const email = `e2e-${Date.now()}@test.local`;
await j("auth.register", { email, password: "Probe12345!", name: "e2e" });
const login = await j("auth.login", { email, password: "Probe12345!" });
const token = login.tokens.accessToken;
const canvas = await j("canvas.create", { name: "e2e-video" }, token);
const canvasId = canvas.canvas_id;
console.log("canvas:", canvasId.slice(0, 8));

const scriptId = crypto.randomUUID();
await j("canvas.save", {
  canvas_id: canvasId,
  nodes: [{
    id: scriptId, type: "script", position: { x: 0, y: 0 },
    data: {
      content: "《晨光里的猫》：清晨花园，一只橘猫在花架下打盹。一只白蝴蝶飞来停在它鼻尖，橘猫惊醒扑了个空，蝴蝶翩然飞走，橘猫望着天空。",
      status: "idle",
    },
    status: "idle",
  }],
  edges: [],
}, token);
console.log("script saved:", scriptId.slice(0, 8));

// WS 监听管线事件
const ws = new WebSocket(`${API.replace("http", "ws")}/ws?token=${token}`);
const sql = postgres("postgres://vimax:vimax@localhost:5432/vimax");
const t0 = Date.now();
const at = () => `${((Date.now() - t0) / 1000).toFixed(0)}s`;

const finish = (ok: boolean, msg: string) => {
  console.log(`[${at()}] ${ok ? "✅" : "❌"} ${msg}`);
  ws.close(); sql.end();
  setTimeout(() => process.exit(ok ? 0 : 1), 300);
};

ws.on("open", async () => {
  ws.send(JSON.stringify({ type: "chat.subscribe", canvasId }));
  const run = await j("canvas.runAutoPipeline", { canvas_id: canvasId, script_node_id: scriptId, concurrency: 2 }, token);
  console.log(`[${at()}] pipeline started, run_id:`, run.run_id.slice(0, 8));
});
ws.on("message", async (raw) => {
  const m = JSON.parse(String(raw));
  if (m.type === "pipeline.stage_start") console.log(`[${at()}] ▶ stage: ${m.stage}`);
  if (m.type === "pipeline.stage_done") console.log(`[${at()}] ✔ stage: ${m.stage}`);
  if (m.type === "pipeline.node_failed") console.log(`[${at()}] ⚠ ${m.stage}/${m.nodeId?.slice(0, 6)} ${String(m.error).slice(0, 80)}`);
  if (m.type === "pipeline.node_skipped") console.log(`[${at()}] ⇢ skipped ${m.stage}/${m.nodeId?.slice(0, 6)} ${String(m.reason).slice(0, 60)}`);
  if (m.type === "pipeline.finished") {
    console.log(`[${at()}] pipeline.finished:`, JSON.stringify(m.summary));
    // 终态核对：concat 产物
    const nodes = await sql`SELECT type, status, output_asset_id::text AS out FROM canvas_nodes WHERE canvas_id = ${canvasId} AND type IN ('image','video','concat')`;
    const done = nodes.filter((n) => n.status === "done").length;
    const concat = nodes.find((n) => n.type === "concat");
    console.log(`[${at()}] 终态: ${done}/${nodes.length} done, concat=${concat?.status ?? "无"}`);
    if (concat?.status === "done" && concat.out) {
      const a = await sql`SELECT id::text, size_bytes, mime_type FROM assets WHERE id = ${concat.out}`;
      finish(true, `合成视频就绪 asset=${concat.out.slice(0, 8)} ${(Number(a[0]?.size_bytes ?? 0) / 1024 / 1024).toFixed(1)}MB`);
    } else {
      finish(false, `concat 未完成（${concat?.status ?? "missing"}）`);
    }
  }
});
ws.on("error", (e) => finish(false, `ws: ${e.message}`));
setTimeout(async () => {
  const nodes = await sql`SELECT type, status FROM canvas_nodes WHERE canvas_id = ${canvasId}`;
  const by: Record<string, string[]> = {};
  for (const n of nodes) (by[n.type] ??= []).push(n.status);
  finish(false, `超时。节点状态: ${JSON.stringify(by)}`);
}, 12 * 60 * 1000);

// Smoke test: drive the agent's generate_script tool end-to-end against the
// real LLM + DB, bypassing WebSocket. Asserts a script node with content is
// created on the canvas. Run: npx tsx scripts/smoke-generate-script.ts
import "dotenv/config";
import { createCanvas } from "../src/domain/canvas/canvas.service.js";
import { executeToolCall } from "../src/domain/agent/decision-layer.js";
import { getDb } from "../src/infrastructure/db/client.js";
import { canvasNodes } from "../src/infrastructure/db/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  const { canvas_id } = await createCanvas({ name: "smoke-test" });
  console.log("[smoke] created canvas:", canvas_id);

  const prompt = "一个 15 秒的电商短视频创意：白色运动鞋，海滩日落场景，年轻女性穿着跑步，强调轻盈与活力";
  console.log("[smoke] calling generate_script with prompt:", prompt.slice(0, 40), "...");

  const result = await executeToolCall("generate_script", { prompt }, canvas_id, {});
  console.log("[smoke] executeToolCall result:", JSON.stringify(result, null, 2));

  const db = getDb();
  const nodes = await db.select().from(canvasNodes).where(eq(canvasNodes.canvasId, canvas_id));
  console.log(`[smoke] canvas now has ${nodes.length} node(s)`);
  for (const n of nodes) {
    const data = n.data as Record<string, unknown>;
    const content = String(data.content ?? "");
    console.log(`  - ${n.type} (${n.id.slice(0, 8)}) status=${n.status} content.len=${content.length}`);
  }

  const scriptNode = nodes.find((n) => n.type === "script");
  const content = String((scriptNode?.data as Record<string, unknown>)?.content ?? "");
  if (!scriptNode || !content) {
    console.error("[smoke] FAIL: no script node with content was created");
    process.exit(1);
  }
  console.log("[smoke] PASS: script node created with", content.length, "chars");
  console.log("[smoke] preview:", content.slice(0, 120).replace(/\n/g, " "), "...");
  process.exit(0);
}

main().catch((e) => {
  console.error("[smoke] ERROR:", e);
  process.exit(1);
});

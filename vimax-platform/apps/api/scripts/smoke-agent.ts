// Smoke test: the REAL chat→canvas path (minus WebSocket). Drives the
// streaming decision agent, then executes every tool call it emits — exactly
// what handleChatSend does. Asserts the agent splits the idea into multiple
// node types (script / storyboard cells / characters).
// Run: npx tsx scripts/smoke-agent.ts
import "dotenv/config";
import { createCanvas } from "../src/domain/canvas/canvas.service.js";
import { runDecisionAgent, executeToolCall } from "../src/domain/agent/decision-layer.js";
import { getDb } from "../src/infrastructure/db/client.js";
import { canvasNodes } from "../src/infrastructure/db/schema.js";
import { eq } from "drizzle-orm";

async function main() {
  const { canvas_id } = await createCanvas({ name: "smoke-agent" });
  console.log("[smoke] canvas:", canvas_id);

  const message =
    "做一个15秒的电商短视频：白色运动鞋，海滩日落场景，年轻女性跑步，强调轻盈与活力。请生成剧本，并自动拆分分镜和提取角色。";

  console.log("[smoke] running decision agent in a multi-turn loop (like handleChatSend)...");
  const MAX_TURNS = 6;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const turnPrompt = turn === 0
      ? message
      : "继续推进工作流：先查看画布上已有的节点，再执行下一步（已生成剧本→提取角色并生成分镜；已有分镜→创建镜头节点）。若全部完成，只回复「完成」不再调用工具。";

    const result = await runDecisionAgent(
      canvas_id,
      turnPrompt,
      (chunk) => {
        if (chunk.type === "tool-call" && chunk.toolName) {
          console.log(`  [turn ${turn} stream tool-call] ${chunk.toolName}`);
        }
        if (chunk.type === "error") console.log("  [stream error]", chunk.error);
      },
      undefined,
    );
    if (result.text.trim()) console.log(`[turn ${turn}] text: ${result.text.trim().slice(0, 100).replace(/\n/g, " ")}`);
    console.log(`[turn ${turn}] toolCalls:`, result.toolCalls.map((t) => t.name));

    if (result.toolCalls.length === 0) {
      console.log(`[turn ${turn}] no more tool calls — done.`);
      break;
    }
    for (const tc of result.toolCalls) {
      const r = await executeToolCall(tc.name, tc.args, canvas_id, {});
      console.log(`  [exec] ${tc.name} -> success=${r.success} | ${r.message.slice(0, 70)}`);
    }
  }

  const db = getDb();
  const nodes = await db.select().from(canvasNodes).where(eq(canvasNodes.canvasId, canvas_id));
  const byType: Record<string, number> = {};
  for (const n of nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;
  console.log(`[smoke] canvas now has ${nodes.length} node(s):`, byType);

  const hasScript = byType.script > 0;
  if (!hasScript) {
    console.error("[smoke] FAIL: agent did not produce a script node");
    process.exit(1);
  }
  console.log("[smoke] PASS: agent produced nodes including a script");
  process.exit(0);
}

main().catch((e) => {
  console.error("[smoke] ERROR:", e);
  process.exit(1);
});

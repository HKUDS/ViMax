// End-to-end smoke through the LIVE API + WebSocket: creates a canvas +
// conversation, sends a chat message over WS, and asserts the agent
// produces script + storyboard nodes (the full auto-split pipeline).
// Run: npx tsx scripts/e2e-ws-chat.ts
import "dotenv/config";
import { createCanvas } from "../src/domain/canvas/canvas.service.js";
import { getDb } from "../src/infrastructure/db/client.js";
import { agentConversations, canvasNodes } from "../src/infrastructure/db/schema.js";
import { eq } from "drizzle-orm";
import { WebSocket } from "ws";

const WS_URL = process.env.WS_URL ?? "ws://localhost:3001/ws";

async function main() {
  const { canvas_id } = await createCanvas({ name: "e2e-ws" });
  const db = getDb();
  const [conv] = await db
    .insert(agentConversations)
    .values({ canvasId: canvas_id, title: "e2e" })
    .returning();
  const conversationId = conv!.id;
  console.log("[e2e] canvas:", canvas_id, "conversation:", conversationId);

  const mutations: unknown[] = [];
  const toolResults: unknown[] = [];
  let complete = false;
  let lastDelta = "";

  await new Promise<void>((resolve) => {
    const ws = new WebSocket(WS_URL);
    const timeout = setTimeout(() => {
      console.log("[e2e] timeout reached (150s), finishing");
      try { ws.close(); } catch {}
      resolve();
    }, 150_000);

    ws.on("open", () => {
      console.log("[e2e] ws connected, subscribing + sending chat.send");
      ws.send(JSON.stringify({ type: "chat.subscribe", canvasId: canvas_id }));
      setTimeout(() => {
        ws.send(JSON.stringify({
          type: "chat.send",
          conversationId,
          content: "做一个15秒的电商短视频：白色运动鞋，海滩日落，年轻女性跑步，强调轻盈活力。请生成剧本，并自动拆分分镜、提取角色。",
        }));
      }, 400);
    });

    ws.on("message", (raw) => {
      const msg = JSON.parse(raw.toString()) as Record<string, unknown>;
      switch (msg.type) {
        case "chat.delta":
          lastDelta = String((msg as { content?: string }).content ?? "");
          break;
        case "chat.tool_call":
          console.log("[e2e]  tool_call:", (msg as { tool: { name: string } }).tool.name);
          break;
        case "chat.tool_result": {
          const tool = (msg as { tool: { name: string; status: string } }).tool;
          console.log("[e2e]  tool_result:", tool.name, tool.status);
          toolResults.push(msg);
          break;
        }
        case "chat.canvas_mutation":
          mutations.push(msg);
          break;
        case "chat.complete":
          console.log("[e2e] chat.complete received");
          complete = true;
          clearTimeout(timeout);
          try { ws.close(); } catch {}
          resolve();
          break;
        case "chat.error":
          console.log("[e2e] chat.error:", (msg as { error?: string }).error);
          break;
      }
    });

    ws.on("error", (e) => console.log("[e2e] ws error:", (e as Error).message));
  });

  const nodes = await db.select().from(canvasNodes).where(eq(canvasNodes.canvasId, canvas_id));
  const byType: Record<string, number> = {};
  for (const n of nodes) byType[n.type] = (byType[n.type] ?? 0) + 1;

  console.log(`[e2e] WS received: ${mutations.length} mutations, ${toolResults.length} tool_results, complete=${complete}`);
  console.log("[e2e] last delta:", lastDelta.slice(0, 80));
  console.log(`[e2e] canvas nodes (${nodes.length}):`, byType);

  const ok = (byType.script ?? 0) > 0 && (byType.storyboard_cell ?? 0) > 0;
  if (!ok) {
    console.error("[e2e] FAIL: expected script + storyboard_cell nodes");
    process.exit(1);
  }
  console.log("[e2e] PASS: full chat → auto-split → canvas path works");
  process.exit(0);
}

main().catch((e) => { console.error("[e2e] ERROR:", e); process.exit(1); });

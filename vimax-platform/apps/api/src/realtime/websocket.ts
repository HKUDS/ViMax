import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import type {
  AgentMessage,
  ClientWsMessage,
  CanvasMutation,
} from "@vimax/contracts";
import {
  addConnection,
  removeConnection,
  joinRoom,
  subscribeConversation,
  sendToConnection,
  getUserId,
  getCanvasId,
  broadcastToRoom,
  broadcastToRoomExcept,
} from "./connection-manager.js";
import { verifyAccessToken } from "../domain/auth/jwt.js";

// ── WebSocket Upgrade Handler ───────────────────────────────────────
// Creates a WebSocket server that shares the HTTP server's port.
// Clients connect at /ws and send subscribe/join messages to
// associate themselves with canvas rooms.

let wss: WebSocketServer | null = null;

export function createWebSocketServer(): WebSocketServer {
  wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (ws: WebSocket, _req: IncomingMessage) => {
    console.log("[ws] Client connected. Total:", wss?.clients.size ?? 0);

    // userId is already bound at upgrade time via addConnection in handleUpgrade.

    ws.on("message", (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as ClientWsMessage;
        handleClientMessage(ws, msg);
      } catch (err) {
        console.error("[ws] Failed to parse message:", err);
        sendToConnection(ws, {
          type: "chat.error",
          conversationId: "",
          error: "Invalid message format",
        });
      }
    });

    ws.on("close", () => {
      console.log("[ws] Client disconnected.");
      const canvasId = getCanvasId(ws);
      const userId = getUserId(ws);
      removeConnection(ws);
      if (canvasId && userId) {
        broadcastToRoom(canvasId, {
          type: "canvas.presence_leave",
          canvasId,
          userId,
        });
      }
    });

    ws.on("error", (err) => {
      console.error("[ws] Connection error:", err);
      removeConnection(ws);
    });
  });

  return wss;
}

/**
 * Handle the HTTP upgrade to WebSocket.
 * Call this from the server's "upgrade" event.
 */
export function handleUpgrade(
  req: IncomingMessage,
  socket: Duplex,
  head: Buffer,
): void {
  if (!wss) {
    socket.destroy();
    return;
  }

  // Only upgrade requests to /ws
  const url = req.url ?? "/";
  if (!url.startsWith("/ws")) {
    socket.destroy();
    return;
  }

  // Authenticate via access token in the query string — same level of
  // authorization as tRPC's protectedProcedure (the data model is
  // tenant-scoped, not per-user, so this checks identity, not ownership).
  // Anonymous upgrades are rejected.
  const token = new URL(url, "http://localhost").searchParams.get("token");
  const payload = token ? verifyAccessToken(token) : null;
  if (!payload) {
    socket.destroy();
    return;
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    // Bind the authenticated user before emitting so every downstream
    // handler sees a connection with a known identity.
    addConnection(ws, payload.sub);
    wss!.emit("connection", ws, req);
  });
}

// ── Client Message Router ───────────────────────────────────────────

const activeChatAbort = new Map<string, AbortController>();

function handleClientMessage(ws: WebSocket, msg: ClientWsMessage): void {
  switch (msg.type) {
    case "chat.subscribe": {
      // Client joins a canvas room to receive all chat events for that canvas
      joinRoom(ws, msg.canvasId);
      console.log(`[ws] Client joined room: ${msg.canvasId}`);
      break;
    }

    case "chat.send": {
      // Handle incoming chat message
      // The actual agent processing will be handled by the chat service
      // For now, just subscribe the connection to this conversation's events
      subscribeConversation(ws, msg.conversationId);

      // Emit to let the chat service pick this up
      handleChatSend(ws, msg.conversationId, msg.content, msg.modelId);
      break;
    }

    case "chat.stop": {
      activeChatAbort.get(msg.conversationId)?.abort();
      activeChatAbort.delete(msg.conversationId);
      console.log(`[ws] Stop requested for conversation: ${msg.conversationId}`);
      break;
    }

    case "pipeline.cancel": {
      cancelAutoPipeline(msg.runId);
      break;
    }

    case "canvas.presence": {
      void relayPresence(ws, msg);
      break;
    }

    default: {
      console.warn("[ws] Unknown message type:", (msg as Record<string, unknown>).type);
    }
  }
}

// ── Presence relay ──────────────────────────────────────────────────

const userNameCache = new Map<string, string>();

function colorForUser(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = (hash * 31 + userId.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360} 70% 55%)`;
}

async function getDisplayName(userId: string): Promise<string> {
  const cached = userNameCache.get(userId);
  if (cached) return cached;
  try {
    const db = getDb();
    const [user] = await db
      .select({ name: users.name })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    const name = user?.name ?? `用户 ${userId.slice(0, 4)}`;
    userNameCache.set(userId, name);
    return name;
  } catch {
    return `用户 ${userId.slice(0, 4)}`;
  }
}

/** Re-emit the sender's pointer/selection to the rest of the canvas room. */
async function relayPresence(
  ws: WebSocket,
  msg: Extract<ClientWsMessage, { type: "canvas.presence" }>,
): Promise<void> {
  const userId = getUserId(ws);
  if (!userId) return;
  broadcastToRoomExcept(msg.canvasId, ws, {
    type: "canvas.presence",
    canvasId: msg.canvasId,
    userId,
    name: await getDisplayName(userId),
    color: colorForUser(userId),
    cursor: msg.cursor,
    selectedNodeIds: msg.selectedNodeIds,
  });
}

// ── Chat send handler — real Agent integration ─────────────────────────

import { getDb } from "../infrastructure/db/client.js";
import {
  agentConversations,
  agentMessages,
  users,
  type AgentMessageRow,
} from "../infrastructure/db/schema.js";
import { desc, eq } from "drizzle-orm";
import { broadcastToConversation } from "./connection-manager.js";
import { runDecisionAgent, executeToolCall, buildCanvasContext } from "../domain/agent/decision-layer.js";
import { cancelAutoPipeline } from "../domain/canvas/pipeline-orchestrator.js";
import type { AIStreamChunk, AIMessage } from "../domain/agent/ai-service.js";
import {
  MAX_AGENT_STEPS,
  AGENT_TOKEN_BUDGET,
  HISTORY_WINDOW,
  canonicalToolKey,
  isRepeatedFailure,
  toolResultMessage,
} from "../domain/agent/agent-loop.js";
import { startTrace, runWithTrace } from "../infrastructure/observability/trace.js";
import { summarizeConversation, extractProfileSignals } from "../domain/memory/memory.service.js";

function toAgentMessage(message: AgentMessageRow): AgentMessage {
  return {
    id: message.id,
    conversationId: message.conversationId,
    role: message.role,
    content: message.content,
    metadata: (message.metadata as AgentMessage["metadata"]) ?? {},
    status: message.status,
    createdAt: message.createdAt.toISOString(),
  };
}

/**
 * Replay the recent conversation as model messages (oldest first),
 * excluding the just-persisted user message and the assistant placeholder.
 */
async function loadRecentHistory(
  conversationId: string,
  limit: number,
  excludeIds: number[],
): Promise<AIMessage[]> {
  const db = getDb();
  const rows = await db
    .select({
      id: agentMessages.id,
      role: agentMessages.role,
      content: agentMessages.content,
    })
    .from(agentMessages)
    .where(eq(agentMessages.conversationId, conversationId))
    .orderBy(desc(agentMessages.createdAt))
    .limit(limit + excludeIds.length + 4);

  return rows
    .filter((r) => !excludeIds.includes(r.id) && r.content.trim())
    .filter((r) => r.role === "user" || r.role === "assistant")
    .slice(0, limit)
    .reverse()
    .map((r) => ({ role: r.role as "user" | "assistant", content: r.content }));
}

/**
 * Handle a chat.send message from a client.
 * Persists the user message and triggers the real DecisionAgent.
 */
async function handleChatSend(
  ws: WebSocket,
  conversationId: string,
  content: string,
  modelId?: string,
): Promise<void> {
  try {
    const db = getDb();

    // Verify conversation exists and get canvas ID
    const convRows = await db
      .select()
      .from(agentConversations)
      .where(eq(agentConversations.id, conversationId))
      .limit(1);

    if (convRows.length === 0) {
      sendToConnection(ws, {
        type: "chat.error",
        conversationId,
        error: "Conversation not found",
      });
      return;
    }

    const conv = convRows[0]!;
    const canvasId = conv.canvasId;

    // Persist user message
    const [userMsg] = await db
      .insert(agentMessages)
      .values({
        conversationId,
        role: "user",
        content,
        status: "complete",
        metadata: {},
      })
      .returning();

    // Broadcast user message arrival to room
    broadcastToRoom(canvasId, {
      type: "chat.message",
      conversationId,
      message: toAgentMessage(userMsg),
    });

    // Create assistant message placeholder (streaming)
    const [assistantMsg] = await db
      .insert(agentMessages)
      .values({
        conversationId,
        role: "assistant",
        content: "",
        status: "streaming",
        metadata: {},
      })
      .returning();

    // ── Run the real Decision Agent ──

    // Check if an AI provider is configured (DB model apiKey or env vars).
    // 选中行的凭据优先于默认行 — 用户选了哪个模型就按哪个判断。
    const { getDefaultModel, getModelById } = await import("../domain/model/model.service.js");
    let defaultTextModel: Awaited<ReturnType<typeof getDefaultModel>> | null = null;
    try { defaultTextModel = await getDefaultModel("default", "text"); } catch {}
    const selectedModel = modelId ? await getModelById(modelId).catch(() => null) : null;
    const dbApiKey = selectedModel?.apiKey ?? defaultTextModel?.apiKey;
    const hasAI =
      !!dbApiKey ||
      (!!process.env.AI_BASE_URL || !!process.env.OPENAI_BASE_URL) &&
        !!(process.env.AI_API_KEY ?? process.env.OPENAI_API_KEY ?? process.env.ARK_API_KEY);

    if (!hasAI) {
      // Fallback: no AI provider configured, return helpful message
      const ctx = await buildCanvasContext(canvasId);
      const nodeSummary = ctx
        ? `当前画布 "${ctx.canvasName}" 有 ${ctx.nodes.length} 个节点。`
        : "";

      const fallbackResponse = `AI Provider 未配置。请在 .env 中设置以下变量后重启 API：\n\n` +
        `\`\`\`\nAI_BASE_URL=https://your-provider.com/v1\nAI_API_KEY=your-api-key\n\`\`\`\n\n` +
        `${nodeSummary}\n\n您的消息: "${content}"`;

      broadcastToConversation(conversationId, {
        type: "chat.delta",
        conversationId,
        content: fallbackResponse,
      });

      const [completedAssistantMessage] = await db
        .update(agentMessages)
        .set({ content: fallbackResponse, status: "complete" })
        .where(eq(agentMessages.id, assistantMsg.id))
        .returning();

      broadcastToConversation(conversationId, {
        type: "chat.complete",
        conversationId,
        message: toAgentMessage(completedAssistantMessage!),
      });
      return;
    }

    // Real agent processing: a true tool loop. The model sees the whole
    // conversation — including each tool result fed back as a message — and
    // decides the next action itself until done, or a budget trips
    // (step cap / token cap / same-failed-call twice).
    let fullResponse = "";
    // Last provider-side stream error — surfaced verbatim in the final
    // message so a misconfigured model row is diagnosable from the chat.
    let lastStreamError: string | null = null;
    const toolCalls: Array<{ name: string; args: Record<string, unknown>; status: "completed" | "failed" }> = [];

    // Callback: broadcast canvas mutations to all clients viewing this canvas
    const onCanvasMutation = (mutation: CanvasMutation) => {
      broadcastToRoom(canvasId, {
        type: "chat.canvas_mutation",
        conversationId,
        mutation,
      });
    };

    // Stream chunks → client (used for every turn)
    const onChunk = (chunk: AIStreamChunk) => {
      switch (chunk.type) {
        case "thinking-start":
          broadcastToConversation(conversationId, {
            type: "chat.thinking", conversationId, content: "思考中…",
          });
          break;
        case "thinking-delta":
          broadcastToConversation(conversationId, {
            type: "chat.thinking", conversationId, content: chunk.thinking ?? "",
          });
          break;
        case "text-delta":
          broadcastToConversation(conversationId, {
            type: "chat.delta", conversationId, content: chunk.text ?? "",
          });
          break;
        case "tool-call":
          if (chunk.toolName) {
            broadcastToConversation(conversationId, {
              type: "chat.tool_call",
              conversationId,
              tool: {
                id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                name: chunk.toolName,
                args: chunk.toolArgs ?? {},
                status: "running",
              },
            });
          }
          break;
        case "error":
          lastStreamError = chunk.error ?? "Unknown error";
          broadcastToConversation(conversationId, {
            type: "chat.error", conversationId, error: chunk.error ?? "Unknown error",
          });
          break;
      }
    };

    const abortController = new AbortController();
    activeChatAbort.set(conversationId, abortController);
    const userId = getUserId(ws) ?? undefined;
    const trace = startTrace("chat.agent_loop");
    try {
      await runWithTrace(trace, async () => {
        const history = await loadRecentHistory(conversationId, HISTORY_WINDOW, [
          userMsg.id,
          assistantMsg.id,
        ]);
        const messages: AIMessage[] = [...history, { role: "user", content }];

        // Node counts seed tool-call positioning; executeToolCall keeps
        // them current as nodes are added.
        const nodeTypeCounts: Record<string, number> = {};
        const failureCounts = new Map<string, number>();
        const canvasCtx = await buildCanvasContext(canvasId);
        if (canvasCtx) {
          for (const n of canvasCtx.nodes) {
            nodeTypeCounts[n.type] = (nodeTypeCounts[n.type] ?? 0) + 1;
          }
        }

        let tokensUsed = 0;
        for (let step = 0; step < MAX_AGENT_STEPS; step++) {
          if (abortController.signal.aborted) break;

          const stepSpan = trace.recorder.startSpan("agent.step");
          const result = await runDecisionAgent({
            canvasId,
            messages,
            onChunk,
            modelId,
            userId,
            abortSignal: abortController.signal,
          });
          stepSpan.end({
            tool_calls: result.toolCalls.length,
            text_chars: result.text.length,
          });
          if (abortController.signal.aborted) break;

          if (result.text.trim()) {
            fullResponse += (fullResponse ? "\n\n" : "") + result.text.trim();
          }
          tokensUsed += (result.usage?.promptTokens ?? 0) + (result.usage?.completionTokens ?? 0);

          // Record the assistant turn (with its tool requests) so the next
          // turn's tool results have something to answer to.
          messages.push({
            role: "assistant",
            content: result.text,
            ...(result.toolCalls.length > 0
              ? {
                  tool_calls: result.toolCalls.map((tc) => ({
                    id: tc.id,
                    type: "function" as const,
                    function: { name: tc.name, arguments: JSON.stringify(tc.args) },
                  })),
                }
              : {}),
          });

          if (result.toolCalls.length === 0) break; // agent is done
          if (tokensUsed > AGENT_TOKEN_BUDGET) {
            fullResponse += "\n\n（已达本次对话的执行预算，已停止继续调用工具。）";
            break;
          }

          let circuitBroken = false;
          for (const [index, tc] of result.toolCalls.entries()) {
            if (abortController.signal.aborted) break;

            const toolSpan = trace.recorder.startSpan(`tool.${tc.name}`, { tool: tc.name });
            const execResult = await executeToolCall(
              tc.name, tc.args, canvasId,
              { onCanvasMutation, nodeTypeCounts, userId, modelId },
            );
            toolSpan.end({ success: execResult.success });

            if (execResult.sandboxRun) {
              broadcastToRoom(canvasId, {
                type: "sandbox.run_requested",
                canvasId,
                ...execResult.sandboxRun,
              });
            }

            broadcastToConversation(conversationId, {
              type: "chat.tool_result",
              conversationId,
              tool: {
                id: `tc_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                name: tc.name, args: tc.args,
                status: execResult.success ? "completed" : "failed",
                result: execResult.result,
              },
            });

            // Canvas mutations are already broadcast inside executeToolCall via
            // the onCanvasMutation callback — rebroadcasting here would deliver
            // each nodes.add twice and duplicate nodes on the client.
            fullResponse += `\n\n${tc.name}: ${execResult.message}`;
            toolCalls.push({ name: tc.name, args: tc.args, status: execResult.success ? "completed" : "failed" });

            if (execResult.success && execResult.canvasMutation?.type === "nodes.add") {
              for (const n of execResult.canvasMutation.nodes) {
                nodeTypeCounts[n.type] = (nodeTypeCounts[n.type] ?? 0) + 1;
              }
            }

            // Feed the outcome back so the model decides based on facts.
            messages.push(toolResultMessage(tc.id || `call_${step}_${index}`, execResult));

            if (
              !execResult.success &&
              isRepeatedFailure(failureCounts, canonicalToolKey(tc.name, tc.args))
            ) {
              fullResponse += "\n\n（同一操作连续失败，已停止执行以避免无效循环，请调整要求后重试。）";
              circuitBroken = true;
              break;
            }
          }
          if (circuitBroken) break;
        }

        // If no text was generated but tool calls were made, add summary
        if (!fullResponse.trim() && toolCalls.length > 0) {
          fullResponse = `已执行 ${toolCalls.length} 个操作。`;
        }

        // If neither text nor tool calls, provide a fallback
        if (!fullResponse.trim()) {
          fullResponse = abortController.signal.aborted
            ? "已停止生成。"
            : lastStreamError
              ? `AI 调用失败：${lastStreamError.slice(0, 300)}\n\n当前模型：${(selectedModel ?? defaultTextModel)?.name ?? "默认"}。请在「设置 → 模型配置」中检查该模型的 Base URL、模型 ID 与 API Key。`
              : "我已收到您的消息，但暂时无法处理。请确保 AI Provider 已正确配置。";
        }
      });
    } catch (agentErr) {
      if (abortController.signal.aborted) {
        fullResponse = "已停止生成。";
      } else {
        console.error("[ws] Agent error:", agentErr);
        fullResponse = `处理时出错: ${agentErr instanceof Error ? agentErr.message : "Unknown error"}`;
      }
    } finally {
      activeChatAbort.delete(conversationId);
      trace.recorder.endRoot({ tool_calls_total: toolCalls.length });
      await trace.recorder.flush();
    }

    // Persist the complete assistant message
    const [completedAssistantMessage] = await db
      .update(agentMessages)
      .set({
        content: fullResponse,
        status: "complete",
        metadata: {
          ...(toolCalls.length > 0 ? { toolCalls } : {}),
        },
      })
      .where(eq(agentMessages.id, assistantMsg.id))
      .returning();

    // Broadcast completion
    broadcastToConversation(conversationId, {
      type: "chat.complete",
      conversationId,
      message: toAgentMessage(completedAssistantMessage!),
    });

    // Memory flywheel (L1 episodic + L2 profile): distill this exchange in
    // the background — never blocks or fails the chat turn.
    if (userId) {
      void summarizeConversation(conversationId)
        .then(() =>
          extractProfileSignals(userId, [
            { role: "user", content },
            { role: "assistant", content: fullResponse },
          ]),
        )
        .catch((err) =>
          console.error("[ws] Memory extraction failed:", err instanceof Error ? err.message : err),
        );
    }
  } catch (err) {
    console.error("[ws] handleChatSend error:", err);
    sendToConnection(ws, {
      type: "chat.error",
      conversationId,
      error: "Internal server error processing message",
    });
  }
}

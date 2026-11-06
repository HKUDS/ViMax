// ── Chat / Agent Conversation Types ─────────────────────────────────
// Shared types for the AI chat panel and agent communication layer.

import type { CanvasNodeStatus, VariantEntry } from "./canvas-types.js";

// ── Conversation ────────────────────────────────────────────────────

export interface AgentConversation {
  id: string;
  canvasId: string;
  title: string | null;
  createdAt: string;
  updatedAt: string;
}

// ── Message ─────────────────────────────────────────────────────────

export const MESSAGE_ROLES = ["user", "assistant", "system"] as const;
export type MessageRole = (typeof MESSAGE_ROLES)[number];

export const MESSAGE_STATUSES = [
  "pending",
  "streaming",
  "complete",
  "error",
] as const;
export type MessageStatus = (typeof MESSAGE_STATUSES)[number];

export interface AgentMessage {
  id: number;
  conversationId: string;
  role: MessageRole;
  content: string;
  metadata: MessageMetadata;
  status: MessageStatus;
  createdAt: string;
}

export interface MessageMetadata {
  /** Tool calls made by the agent during this message */
  toolCalls?: ToolCall[];
  /** Thinking / reasoning content (for models that support it) */
  thinking?: string;
  /** References to canvas nodes or assets */
  references?: MessageReference[];
  /** Duration in ms for agent response generation */
  durationMs?: number;
}

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  status: "pending" | "running" | "completed" | "failed";
  result?: unknown;
}

export interface MessageReference {
  type: "node" | "asset" | "job";
  id: string;
  label?: string;
}

// ── WebSocket Message Protocol ──────────────────────────────────────

export type PipelineStage = "characters" | "storyboard" | "shot" | "image" | "video" | "concat";

/** Client → Server messages */
export type ClientWsMessage =
  | { type: "chat.send"; conversationId: string; content: string; modelId?: string }
  | { type: "chat.stop"; conversationId: string }
  | { type: "chat.subscribe"; canvasId: string }
  | { type: "pipeline.cancel"; runId: string; canvasId: string }
  | {
      type: "canvas.presence";
      canvasId: string;
      /** Cursor position in flow coordinates; null when the pointer left. */
      cursor: { x: number; y: number } | null;
      selectedNodeIds: string[];
    };

/** Server → Client messages */
export type ServerWsMessage =
  | { type: "chat.message"; conversationId: string; message: AgentMessage }
  | { type: "chat.thinking"; conversationId: string; content: string }
  | { type: "chat.delta"; conversationId: string; content: string }
  | { type: "chat.tool_call"; conversationId: string; tool: ToolCall }
  | { type: "chat.tool_result"; conversationId: string; tool: ToolCall }
  | { type: "chat.canvas_mutation"; conversationId: string; mutation: CanvasMutation }
  | { type: "chat.complete"; conversationId: string; message: AgentMessage }
  | { type: "chat.error"; conversationId: string; error: string }
  | { type: "pipeline.stage_start"; runId: string; canvasId: string; stage: PipelineStage; nodeIds: string[] }
  | { type: "pipeline.stage_progress"; runId: string; canvasId: string; stage: PipelineStage; done: number; total: number }
  | { type: "pipeline.stage_done"; runId: string; canvasId: string; stage: PipelineStage }
  | { type: "pipeline.node_failed"; runId: string; canvasId: string; stage: PipelineStage; nodeId: string; error: string }
  | { type: "pipeline.node_skipped"; runId: string; canvasId: string; stage: PipelineStage; nodeId: string; reason: string }
  | { type: "pipeline.finished"; runId: string; canvasId: string; summary: { succeeded: number; failed: number; skipped?: number; cancelled?: boolean; message?: string } }
  // Reuse existing job progress events via WebSocket
  | { type: "job.progress"; jobId: string; progress: number }
  | { type: "job.completed"; jobId: string; outputAssetId: string }
  | { type: "job.failed"; jobId: string; error: string }
  // Live node status — broadcast to everyone viewing the canvas so the
  // reactive cascade (auto re-run of stale downstream nodes) is visible.
  | {
      type: "canvas.node_status";
      canvasId: string;
      nodeId: string;
      status: CanvasNodeStatus;
      outputAssetId?: string | null;
      jobId?: string | null;
      /** Present when a variant gallery update accompanies the status change. */
      variants?: VariantEntry[];
    }
  // Nodes were deleted server-side (e.g. pipeline regeneration) — every
  // viewer must drop them (and their edges) from the local graph.
  | { type: "canvas.nodes_removed"; canvasId: string; nodeIds: string[] }
  // Browser sandbox execution request (run_code tool → T3 Pyodide runner).
  // The requesting client fetches inputs from its local asset vault,
  // executes the script in Pyodide, uploads outputs and reports back via
  // the sandbox.runs.complete tRPC mutation.
  | {
      type: "sandbox.run_requested";
      canvasId: string;
      runId: string;
      name: string;
      language: string;
      code: string;
      inputAssetIds: string[];
    }
  // Realtime presence — the server relays the sender's pointer/selection to
  // everyone else in the canvas room (never echoed back to the sender).
  | {
      type: "canvas.presence";
      canvasId: string;
      userId: string;
      name: string;
      color: string;
      cursor: { x: number; y: number } | null;
      selectedNodeIds: string[];
    }
  | { type: "canvas.presence_leave"; canvasId: string; userId: string };

// ── Canvas Mutation (Agent → Frontend) ──────────────────────────────

export type CanvasMutation =
  | { type: "nodes.add"; nodes: CanvasMutationNode[] }
  | {
      type: "nodes.update";
      updates: { id: string; data: Partial<Record<string, unknown>> }[];
    }
  | { type: "nodes.remove"; ids: string[] }
  | {
      type: "edges.add";
      edges: {
        id: string;
        source: string;
        target: string;
        sourceHandle?: string;
        targetHandle?: string;
      }[];
    }
  | { type: "edges.remove"; ids: string[] }
  | { type: "layout.arrange"; direction: "LR" | "TB" | "zone" };

export interface CanvasMutationNode {
  id: string;
  type: string;
  position: { x: number; y: number };
  data: Record<string, unknown>;
}

// ── Chat Router Input/Output Types ──────────────────────────────────

export interface CreateConversationInput {
  canvasId: string;
  title?: string;
}

export interface CreateConversationOutput {
  conversation: AgentConversation;
}

export interface ListConversationsInput {
  canvasId: string;
  cursor?: string;
  limit?: number;
}

export interface ListConversationsOutput {
  items: AgentConversation[];
  nextCursor: string | null;
}

export interface GetMessagesInput {
  conversationId: string;
  cursor?: number;
  limit?: number;
}

export interface GetMessagesOutput {
  items: AgentMessage[];
  nextCursor: number | null;
}

export interface DeleteConversationInput {
  conversationId: string;
}

export interface DeleteConversationOutput {
  ok: boolean;
}

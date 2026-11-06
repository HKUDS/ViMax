// ── Agent Context ───────────────────────────────────────────────────
// Builds the context object passed to agent invocations.
// Adapted from Toonflow's AgentContext interface.

import type { CanvasContext } from "./decision-layer.js";

export interface AgentContext {
  /** The canvas this agent is working on */
  canvasId: string;
  /** Canvas context (nodes, edges, etc.) */
  canvasContext: CanvasContext | null;
  /** Active skills for this canvas */
  activeSkills: string[];
  /** Agent isolation key for memory */
  isolationKey: string;
  /** Conversation ID */
  conversationId: string;
  /** Abort signal */
  abortSignal?: AbortSignal;
}

/**
 * Build an agent context for a canvas conversation.
 */
export function createAgentContext(
  canvasId: string,
  conversationId: string,
  canvasContext: CanvasContext | null,
): AgentContext {
  return {
    canvasId,
    canvasContext,
    activeSkills: [],
    isolationKey: `productionAgent:${canvasId}`,
    conversationId,
  };
}

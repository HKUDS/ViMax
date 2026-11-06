// ── Node status broadcast event ────────────────────────────────────
//
// Pure builder for the `canvas.node_status` WebSocket message. Kept
// separate from the realtime layer so the shape is unit-testable and
// the broadcast call sites stay one-liners.

import type { CanvasNodeStatus, ServerWsMessage, VariantEntry } from "@vimax/contracts";
import { broadcastToRoom } from "../../realtime/connection-manager.js";

export interface NodeStatusEventInput {
  canvasId: string;
  nodeId: string;
  status: CanvasNodeStatus;
  /** Present when the node just produced an output (status "done"). */
  outputAssetId?: string | null;
  /** Present when the status change is tied to a job. */
  jobId?: string | null;
  /** Present when a variant gallery update accompanies the status change. */
  variants?: VariantEntry[];
}

export function buildNodeStatusMessage(
  input: NodeStatusEventInput,
): Extract<ServerWsMessage, { type: "canvas.node_status" }> {
  return {
    type: "canvas.node_status",
    canvasId: input.canvasId,
    nodeId: input.nodeId,
    status: input.status,
    ...(input.outputAssetId !== undefined ? { outputAssetId: input.outputAssetId } : {}),
    ...(input.jobId !== undefined ? { jobId: input.jobId } : {}),
    ...(input.variants !== undefined ? { variants: input.variants } : {}),
  };
}

/**
 * Build the event and push it to every client viewing the canvas. A thin
 * emit wrapper over the pure `buildNodeStatusMessage`.
 */
export function broadcastNodeStatus(
  canvasId: string,
  nodeId: string,
  status: CanvasNodeStatus,
  outputAssetId?: string | null,
  jobId?: string | null,
  variants?: VariantEntry[],
): void {
  broadcastToRoom(
    canvasId,
    buildNodeStatusMessage({ canvasId, nodeId, status, outputAssetId, jobId, variants }),
  );
}

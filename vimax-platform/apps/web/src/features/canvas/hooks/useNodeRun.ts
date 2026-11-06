"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { trpc } from "@/lib/trpc/client";
import { runNodeWithLocalRestore } from "@/features/assets/restore-from-local";

const API_BASE =
  (typeof window !== "undefined" &&
    (process.env.NEXT_PUBLIC_API_URL?.replace("/trpc", "") ??
      "http://localhost:3001")) ??
  "http://localhost:3001";

interface UseNodeRunOptions {
  canvasId: string;
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  edges: Edge[];
}

export interface NodeRunState {
  progress: number;
  error: string | null;
  /** true while the job is in flight (from enqueue until completed/failed). */
  active: boolean;
}

type RunNodeFn = (nodeId: string) => Promise<unknown>;

/** Auto-retry once per node per session when the worker marks the failure retryable. */
const MAX_AUTO_RETRIES = 1;

export function useNodeRun({ canvasId, setNodes, edges }: UseNodeRunOptions) {
  const runMutation = trpc.canvas.runNode.useMutation();
  const trpcUtils = trpc.useUtils();
  const [runStates, setRunStates] = useState<Record<string, NodeRunState>>({});
  const sseConnections = useRef(new Map<string, EventSource>());
  const autoRetried = useRef(new Set<string>());
  const runNodeRef = useRef<RunNodeFn | undefined>(undefined);

  useEffect(() => {
    const connections = sseConnections.current;
    return () => {
      for (const es of connections.values()) es.close();
    };
  }, []);

  const patchNode = useCallback(
    (nodeId: string, patch: Record<string, unknown>) => {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === nodeId
            ? { ...n, data: { ...n.data, ...patch } }
            : n,
        ),
      );
    },
    [setNodes],
  );

  const setRunState = useCallback(
    (nodeId: string, patch: Partial<NodeRunState>) => {
      setRunStates((prev) => {
        const current = prev[nodeId] ?? { progress: 0, error: null, active: false };
        return { ...prev, [nodeId]: { ...current, ...patch } };
      });
    },
    [],
  );

  const clearRunState = useCallback((nodeId: string) => {
    setRunStates((prev) => {
      if (!(nodeId in prev)) return prev;
      const { [nodeId]: _removed, ...rest } = prev;
      return rest;
    });
  }, []);

  // One SSE connection per job, keyed by jobId so parallel node runs
  // stream their progress independently.
  const subscribeSSE = useCallback(
    (nodeId: string, jobId: string) => {
      const es = new EventSource(`${API_BASE}/sse/jobs/${jobId}`);
      sseConnections.current.set(jobId, es);
      const close = () => {
        es.close();
        sseConnections.current.delete(jobId);
      };

      es.addEventListener("started", () => {
        patchNode(nodeId, { status: "running" });
        setRunState(nodeId, { progress: 5, active: true });
      });

      es.addEventListener("progress", (e) => {
        try {
          setRunState(nodeId, { progress: JSON.parse(e.data).percent ?? 0 });
        } catch { /* ignore parse errors */ }
      });

      es.addEventListener("completed", () => {
        // Only flip status here — the authoritative outputAssetId arrives
        // via the `canvas.node_status` WebSocket event (the real asset id).
        // The SSE completed payload carries a storage_key, not an asset id,
        // so deriving outputAssetId from it would write a bogus value that
        // later gets persisted into the canvas via save().
        patchNode(nodeId, { status: "done" });
        // Mark downstream nodes dirty in frontend state
        markDownstreamDirty(nodeId, setNodes, edges);
        clearRunState(nodeId);
        close();
      });

      es.addEventListener("failed", (e) => {
        let message = "未知错误";
        let retryable = false;
        try {
          const d = JSON.parse(e.data);
          message = d.error_message ?? message;
          retryable = d.retryable === true;
        } catch { /* keep defaults */ }
        patchNode(nodeId, { status: "failed", errorMsg: message });
        setRunState(nodeId, { active: false, error: message });
        close();

        if (retryable && !autoRetried.current.has(nodeId)) {
          autoRetried.current.add(nodeId);
          void runNodeRef.current?.(nodeId).catch(() => {});
        }
      });

      es.onerror = close;
    },
    [patchNode, setNodes, edges, setRunState, clearRunState],
  );

  const runNode = useCallback(
    async (nodeId: string) => {
      setRunState(nodeId, { progress: 0, error: null, active: true });
      patchNode(nodeId, { status: "running", errorMsg: null });

      try {
        const result = await runNodeWithLocalRestore(
          trpcUtils.client,
          { canvas_id: canvasId, node_id: nodeId },
          (input) => runMutation.mutateAsync(input),
        );
        subscribeSSE(nodeId, result.job_id);
        return result;
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "启动失败";
        patchNode(nodeId, { status: "failed", errorMsg: msg });
        setRunState(nodeId, { active: false, error: msg });
        throw err;
      }
    },
    [canvasId, runMutation, trpcUtils, subscribeSSE, patchNode, setRunState],
  );

  useEffect(() => {
    runNodeRef.current = runNode;
  }, [runNode]);

  const isRunning =
    runMutation.isPending || Object.values(runStates).some((s) => s.active);

  return {
    runNode,
    isRunning,
    nodeRunStates: runStates,
  };
}

// ── BFS helper: mark all downstream nodes dirty ────────────────────

function markDownstreamDirty(
  sourceNodeId: string,
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>,
  edges: Edge[],
) {
  // Build adjacency list (source → target[])
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    const targets = adjacency.get(e.source) ?? [];
    targets.push(e.target);
    adjacency.set(e.source, targets);
  }

  // BFS
  const visited = new Set<string>();
  const queue = [sourceNodeId];
  while (queue.length > 0) {
    const current = queue.shift()!;
    if (visited.has(current)) continue;
    visited.add(current);
    const targets = adjacency.get(current) ?? [];
    for (const t of targets) {
      if (!visited.has(t)) queue.push(t);
    }
  }

  // Mark all downstream (excluding the source) as dirty
  visited.delete(sourceNodeId);
  if (visited.size === 0) return;

  setNodes((nds) =>
    nds.map((n) =>
      visited.has(n.id)
        ? {
            ...n,
            data: {
              ...n.data,
              status: (n.data as Record<string, unknown>)?.status === "done"
                ? "dirty"
                : (n.data as Record<string, unknown>)?.status ?? "dirty",
            },
          }
        : n,
    ),
  );
}

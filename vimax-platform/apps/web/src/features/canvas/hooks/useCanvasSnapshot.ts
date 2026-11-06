"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type OnNodesChange,
  type OnEdgesChange,
} from "@xyflow/react";
import type { CanvasNodeType } from "@vimax/contracts";
import { trpc } from "@/lib/trpc/client";

export interface UseCanvasSnapshotReturn {
  nodes: Node[];
  setNodes: ReturnType<typeof useNodesState>[1];
  onNodesChange: OnNodesChange<Node>;
  edges: Edge[];
  setEdges: ReturnType<typeof useEdgesState>[1];
  onEdgesChange: OnEdgesChange<Edge>;
  canvasName: string;
  updatedAt: string;
  viewport: { x: number; y: number; zoom: number };
  isLoading: boolean;
  isError: boolean;
  error: string | null;
  refetch: () => void;
}

export function useCanvasSnapshot(canvasId: string): UseCanvasSnapshotReturn {
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [canvasName, setCanvasName] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [isLoading, setIsLoading] = useState(true);
  const [isError, setIsError] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const initialLoadDone = useRef(false);
  const forceSyncRef = useRef(false);

  const snapshotQuery = trpc.canvas.snapshot.useQuery(
    { canvas_id: canvasId },
    { enabled: !!canvasId, staleTime: 0 },
  );

  const refetch = useCallback(() => {
    forceSyncRef.current = true;
    void snapshotQuery.refetch();
  }, [snapshotQuery]);

  useEffect(() => {
    if (!snapshotQuery.data) return;

    const { canvas, nodes: apiNodes, edges: apiEdges } = snapshotQuery.data;

    const rfNodes: Node[] = apiNodes.map((n) => ({
      id: n.id,
      type: n.type,
      position: n.position,
      data: { ...n.data, status: n.status, outputAssetId: n.output_asset_id },
    }));

    const rfEdges: Edge[] = apiEdges.map((e) => ({
      id: e.id,
      source: e.source_node_id,
      target: e.target_node_id,
      sourceHandle: e.source_handle ?? undefined,
      targetHandle: e.target_handle ?? undefined,
    }));

    if (!initialLoadDone.current || forceSyncRef.current) {
      // Preserve node object identity for unchanged nodes: React Flow keys
      // its internal measurement cache (measured / handleBounds) off object
      // identity, and replacing every object on each refetch resets it —
      // which silently suppresses all edge rendering.
      setNodes((prev) => {
        const prevById = new Map(prev.map((n) => [n.id, n]));
        return rfNodes.map((n) => {
          const old = prevById.get(n.id);
          if (!old) return n;
          const samePosition =
            old.position.x === n.position.x && old.position.y === n.position.y;
          const sameData = JSON.stringify(old.data) === JSON.stringify(n.data);
          return samePosition && sameData ? old : { ...n, measured: old.measured };
        });
      });
      setEdges(rfEdges);
      setUpdatedAt(canvas.updated_at);
      initialLoadDone.current = true;
      forceSyncRef.current = false;
    }

    setCanvasName(canvas.name);
    setViewport(canvas.viewport);
    setIsLoading(false);
  }, [snapshotQuery.data, setNodes, setEdges]);

  useEffect(() => {
    if (!snapshotQuery.isError || initialLoadDone.current) return;

    setIsLoading(false);
    setIsError(true);
    setError(snapshotQuery.error?.message ?? "加载画布失败，请检查网络连接或登录状态");
  }, [snapshotQuery.isError, snapshotQuery.error]);

  return {
    nodes,
    setNodes,
    onNodesChange,
    edges,
    setEdges,
    onEdgesChange,
    canvasName,
    updatedAt,
    viewport,
    isLoading,
    isError,
    error,
    refetch,
  };
}

// ── Debounced Canvas Save ─────────────────────────────────────────

export function useCanvasSave(canvasId: string, snapshotUpdatedAt: string) {
  const saveMutation = trpc.canvas.save.useMutation();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ nodes: Node[]; edges: Edge[] } | null>(null);
  const snapshotUpdatedAtRef = useRef(snapshotUpdatedAt);

  useEffect(() => {
    if (snapshotUpdatedAt && snapshotUpdatedAt > snapshotUpdatedAtRef.current) {
      snapshotUpdatedAtRef.current = snapshotUpdatedAt;
    }
  }, [snapshotUpdatedAt]);

  const save = useCallback(
    (
      nodes: Node[],
      edges: Edge[],
      viewport?: { x: number; y: number; zoom: number },
    ) => {
      pendingRef.current = { nodes, edges };

      if (timerRef.current) clearTimeout(timerRef.current);

      timerRef.current = setTimeout(async () => {
        const pending = pendingRef.current;
        if (!pending) return;

        try {
          const result = await saveMutation.mutateAsync({
            canvas_id: canvasId,
            snapshot_updated_at: snapshotUpdatedAtRef.current,
            nodes: pending.nodes.map((n) => ({
              id: n.id,
              type: (n.type ?? "image") as CanvasNodeType,
              position: n.position,
              data: n.data as Record<string, unknown>,
            })),
            edges: pending.edges.map((e) => ({
              id: e.id,
              source_node_id: e.source,
              target_node_id: e.target,
              source_handle: e.sourceHandle ?? null,
              target_handle: e.targetHandle ?? null,
            })),
            viewport,
          });
          if (result.updated_at > snapshotUpdatedAtRef.current) {
            snapshotUpdatedAtRef.current = result.updated_at;
          }
        } catch (err) {
          console.error("[canvas save] failed:", err);
        }
      }, 800);
    },
    [canvasId, saveMutation],
  );

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  return { save, isSaving: saveMutation.isPending };
}

"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type DragEvent,
  type ReactNode,
} from "react";
import {
  applyEdgeChanges,
  applyNodeChanges,
  type Node,
  type Edge,
  type Connection,
  type EdgeChange,
  type NodeChange,
} from "@xyflow/react";
import { toast } from "sonner";
import type {
  CanvasMutation,
  CanvasNodeType,
  InstantiatedEdge,
  InstantiatedNode,
  ServerWsMessage,
} from "@vimax/contracts";
import { trpc } from "@/lib/trpc/client";
import { useCanvasWebSocket } from "@/lib/websocket/client";
import { CanvasContext, canvasFocusRequest, canvasFlowBridge, type CanvasContextValue, type PeerPresence } from "./canvas-context";
import { useCanvasSnapshot, useCanvasSave } from "./hooks/useCanvasSnapshot";
import { useNodeRun } from "./hooks/useNodeRun";
import { useUndoRedo } from "./hooks/useUndoRedo";
import { computeDagreLayout, computeZoneLayout } from "./utils/dagre-layout";
import { getDefaultNodeData, FALLBACK_IMAGE_MODEL_ID } from "./utils/node-defaults";
import {
  copyNode,
  copySelectedToClipboard,
  instantiateClipboard,
  removeNodeFromGraph,
  type NodeClipboard,
} from "./utils/graph-mutations";
import {
  alignSelectedNodes,
  distributeSelectedNodes,
  type AlignMode,
  type DistributeMode,
} from "./utils/align";
import { canvasNodeTypes, RUNNABLE_TYPES, type LayoutMode } from "./constants/canvas-flow";
import type { CanvasStats } from "./toolbar/BottomToolbar";
import { useAutoPipeline } from "./hooks/useAutoPipeline";

export interface CanvasProviderProps {
  canvasId: string;
  defaultTextModelId?: string;
  defaultImageModelId?: string;
  defaultVideoModelId?: string;
  initialPrompt?: string;
  initialMode?: string;
  /** Uploaded product image asset id (DAAI-style input flow). */
  productAssetId?: string;
  children: ReactNode;
}

export function CanvasProvider({
  canvasId,
  defaultTextModelId,
  defaultImageModelId,
  defaultVideoModelId,
  initialPrompt,
  initialMode,
  productAssetId,
  children,
}: CanvasProviderProps) {
  const modelDefaults = useMemo(
    () => ({
      imageModelId: defaultImageModelId,
      videoModelId: defaultVideoModelId,
    }),
    [defaultImageModelId, defaultVideoModelId],
  );

  const {
    nodes,
    setNodes,
    onNodesChange,
    edges,
    setEdges,
    onEdgesChange,
    canvasName,
    updatedAt: canvasUpdatedAt,
    viewport: initialViewport,
    isLoading,
    isError,
    error,
    refetch,
  } = useCanvasSnapshot(canvasId);

  const { save } = useCanvasSave(canvasId, canvasUpdatedAt);
  const { state: autoPipelineState, start: startAutoPipeline, cancel: cancelAutoPipeline, retryFailed: retryFailedPipeline, isStarting: autoPipelineStarting } =
    useAutoPipeline(canvasId);
  const [selectedNode, setSelectedNode] = useState<Node | null>(null);
  const { runNode, isRunning, nodeRunStates } = useNodeRun({
    canvasId,
    setNodes,
    edges,
  });

  const [peers, setPeers] = useState<Record<string, PeerPresence & { ts: number }>>({});

  // Prune peers whose heartbeat stopped (client crash, network drop).
  useEffect(() => {
    const prune = setInterval(() => {
      const cutoff = Date.now() - 15_000;
      setPeers((prev) => {
        const next = Object.fromEntries(
          Object.entries(prev).filter(([, p]) => p.ts >= cutoff),
        );
        return Object.keys(next).length === Object.keys(prev).length ? prev : next;
      });
    }, 5_000);
    return () => clearInterval(prune);
  }, []);

  const handleWsMessage = useCallback(
    (msg: ServerWsMessage) => {
      if (msg.type === "canvas.presence") {
        if (msg.canvasId !== canvasId) return;
        const { userId, name, color, cursor, selectedNodeIds } = msg;
        setPeers((prev) => ({
          ...prev,
          [userId]: { name, color, cursor, selectedNodeIds, ts: Date.now() },
        }));
        return;
      }
      if (msg.type === "canvas.presence_leave") {
        if (msg.canvasId !== canvasId) return;
        setPeers((prev) => {
          if (!(msg.userId in prev)) return prev;
          const { [msg.userId]: _removed, ...rest } = prev;
          return rest;
        });
        return;
      }
      if (msg.type === "pipeline.finished") {
        refetch();
      }
      if (msg.type === "pipeline.stage_done" && msg.stage === "storyboard") {
        refetch();
      }
      if (msg.type === "pipeline.stage_done" && msg.stage === "shot") {
        refetch();
      }
      if (msg.type === "canvas.nodes_removed") {
        if (msg.canvasId !== canvasId) return;
        const idsToRemove = new Set(msg.nodeIds);
        const nextNodes = nodes.filter((n) => !idsToRemove.has(n.id));
        const nextEdges = edges.filter(
          (e) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target),
        );
        setNodes(nextNodes);
        setEdges(nextEdges);
        save(nextNodes, nextEdges);
        return;
      }
      if (msg.type !== "canvas.node_status") return;
      const { nodeId, status, outputAssetId, variants } = msg;
      setNodes((nds) => {
        const source = nds.find((n) => n.id === nodeId);
        if (source?.type === "script" && status === "done") {
          queueMicrotask(() => refetch());
        }
        // Only clone the node that actually changed — recreating every node
        // object resets React Flow's internal measurement cache and kills
        // all edge rendering.
        return nds.map((n) =>
          n.id !== nodeId
            ? n
            : {
                ...n,
                data: {
                  ...n.data,
                  status,
                  ...(outputAssetId !== undefined ? { outputAssetId } : {}),
                  ...(variants !== undefined ? { variants } : {}),
                },
              },
        );
      });
    },
    [setNodes, setEdges, save, nodes, edges, refetch, canvasId],
  );
  useCanvasWebSocket({ canvasId, onMessage: handleWsMessage });

  const { snapshot, undo, redo, canUndo, canRedo } = useUndoRedo();
  const [rightPanelTab, setRightPanelTab] = useState<"inspector" | "chat">(
    initialPrompt ? "chat" : "inspector",
  );
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; nodeId?: string } | null>(null);
  const [workbenchId, setWorkbenchId] = useState<string | null>(null);
  const createWorkbench = trpc.workbench.create.useMutation();
  const runDirtyMutation = trpc.canvas.runDirty.useMutation();
  const autoWireMutation = trpc.canvas.autoWire.useMutation();
  const requestUpload = trpc.asset.requestUpload.useMutation();
  const confirmUpload = trpc.asset.confirmUpload.useMutation();
  const [uploading, setUploading] = useState(false);
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("LR");
  const [scrollMode, setScrollMode] = useState<"zoom" | "pan">(() => {
    if (typeof window !== "undefined") {
      const stored = localStorage.getItem("vimax.scrollMode");
      if (stored === "pan" || stored === "zoom") return stored;
    }
    return "zoom";
  });

  // DAAI-style input flow: an uploaded product image lands on an empty
  // canvas as an i2i reference image node (consumed once).
  const productAssetConsumed = useRef(false);
  useEffect(() => {
    if (!productAssetId || productAssetConsumed.current || isLoading) return;
    productAssetConsumed.current = true;
    if (nodes.length > 0) return;
    const newNode: Node = {
      id: crypto.randomUUID(),
      type: "image",
      position: { x: 80, y: 80 },
      data: {
        prompt: "产品参考图（用户上传）",
        referenceAssetIds: [productAssetId],
        // Asset container: the uploaded image IS the output — this node
        // never runs through the image generator.
        status: "done",
        outputAssetId: productAssetId,
      },
    };
    setNodes((nds) => {
      const updated = [...nds, newNode];
      save(updated, edges);
      return updated;
    });
  }, [productAssetId, isLoading, nodes.length, modelDefaults.imageModelId, edges, save, setNodes]);

  const interactionTimeout = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const handleScrollModeChange = useCallback((mode: "zoom" | "pan") => {
    setScrollMode(mode);
    localStorage.setItem("vimax.scrollMode", mode);
  }, []);

  const handleInteractionStart = useCallback(() => {
    clearTimeout(interactionTimeout.current);
  }, []);

  const handleInteractionEnd = useCallback(() => {
    interactionTimeout.current = setTimeout(() => undefined, 150);
  }, []);

  const stats = useMemo<CanvasStats>(() => {
    const byType: Record<string, number> = {};
    const byStatus: Record<string, number> = {};
    for (const n of nodes) {
      const t = n.type ?? "unknown";
      byType[t] = (byType[t] ?? 0) + 1;
      const s = ((n.data as Record<string, unknown> | undefined)?.status as string) ?? "idle";
      byStatus[s] = (byStatus[s] ?? 0) + 1;
    }
    return { byType, byStatus, total: nodes.length };
  }, [nodes]);

  const runnableCount = useMemo(
    () => nodes.filter((n) => RUNNABLE_TYPES.has(n.type ?? "")).length,
    [nodes],
  );

  const selectedNodeIds = useMemo(() => nodes.filter((n) => n.selected).map((n) => n.id), [nodes]);

  const handleRunDirty = useCallback(async () => {
    try {
      const res = await runDirtyMutation.mutateAsync({ canvas_id: canvasId });
      const enq = res.enqueued.length;
      const skip = res.skipped.length;
      if (enq === 0 && skip === 0) {
        toast.info("没有需要重跑的脏节点");
      } else {
        toast.success(`已重跑 ${enq} 个节点${skip ? `（${skip} 个等待上游完成）` : ""}`);
      }
      refetch();
    } catch {
      toast.error("重跑脏节点失败");
    }
  }, [canvasId, refetch, runDirtyMutation]);

  const handleTemplateInstantiated = useCallback(
    (newNodes: InstantiatedNode[], newEdges: InstantiatedEdge[]) => {
      const rfNodes: Node[] = newNodes.map((n) => ({
        id: n.id,
        type: n.type,
        position: n.position,
        data: { ...n.data, status: "idle" },
      }));
      const rfEdges: Edge[] = newEdges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      }));
      const mergedNodes = [...nodes, ...rfNodes];
      const mergedEdges = [...edges, ...rfEdges];
      setNodes(mergedNodes);
      setEdges(mergedEdges);
      save(mergedNodes, mergedEdges);
    },
    [nodes, edges, setNodes, setEdges, save],
  );

  const handleAutoWire = useCallback(async () => {
    if (selectedNodeIds.length < 2) return;
    try {
      const res = await autoWireMutation.mutateAsync({
        canvas_id: canvasId,
        node_ids: selectedNodeIds,
      });
      if (res.created.length === 0) {
        toast.info("没有需要新增的连线");
        return;
      }
      const newEdges: Edge[] = res.created.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        sourceHandle: e.sourceHandle ?? undefined,
        targetHandle: e.targetHandle ?? undefined,
      }));
      const mergedEdges = [...edges, ...newEdges];
      setEdges(mergedEdges);
      save(nodes, mergedEdges);
      toast.success(`已自动连线 ${res.created.length} 条`);
    } catch {
      toast.error("自动连线失败");
    }
  }, [autoWireMutation, canvasId, edges, nodes, save, selectedNodeIds, setEdges]);

  const handleOpenWorkbench = useCallback(async () => {
    try {
      const res = await createWorkbench.mutateAsync({
        canvasId,
        name: `${canvasName ?? "未命名"} - 剪辑`,
      });
      setWorkbenchId(res.id);
    } catch {
      setWorkbenchId(`wb-temp-${canvasId}`);
    }
  }, [canvasId, canvasName, createWorkbench]);

  const handleUndo = useCallback(() => {
    const prev = undo(nodes, edges);
    if (prev) {
      setNodes(prev.nodes);
      setEdges(prev.edges);
      save(prev.nodes, prev.edges);
    }
  }, [undo, nodes, edges, setNodes, setEdges, save]);

  const handleRedo = useCallback(() => {
    const next = redo(nodes, edges);
    if (next) {
      setNodes(next.nodes);
      setEdges(next.edges);
      save(next.nodes, next.edges);
    }
  }, [redo, nodes, edges, setNodes, setEdges, save]);

  const handleCanvasMutation = useCallback(
    (mutation: CanvasMutation) => {
      switch (mutation.type) {
        case "nodes.add": {
          const newNodes: Node[] = mutation.nodes.map((n) => ({
            id: n.id,
            type: n.type,
            position: n.position,
            data: {
              ...getDefaultNodeData(n.type as CanvasNodeType, modelDefaults),
              ...n.data,
              status: "idle",
            },
          }));
          setRecentNodeIds((prev) => [
            ...prev.filter((id) => !mutation.nodes.some((m) => m.id === id)),
            ...mutation.nodes.map((n) => n.id),
          ].slice(-6));
          setNodes((nds) => {
            const updated = [...nds, ...newNodes];
            save(updated, edges);
            return updated;
          });
          break;
        }
        case "nodes.update": {
          setNodes((nds) => {
            const updated = nds.map((n) => {
              const update = mutation.updates.find((u) => u.id === n.id);
              return update ? { ...n, data: { ...n.data, ...update.data } } : n;
            });
            save(updated, edges);
            return updated;
          });
          break;
        }
        case "nodes.remove": {
          const idsToRemove = new Set(mutation.ids);
          const nextNodes = nodes.filter((n) => !idsToRemove.has(n.id));
          const nextEdges = edges.filter(
            (e) => !idsToRemove.has(e.source) && !idsToRemove.has(e.target),
          );
          setNodes(nextNodes);
          setEdges(nextEdges);
          save(nextNodes, nextEdges);
          break;
        }
        case "edges.add": {
          setEdges((eds) => {
            const newEdges = mutation.edges.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle,
              targetHandle: e.targetHandle,
            }));
            const updated = [...eds, ...newEdges];
            save(nodes, updated);
            return updated;
          });
          break;
        }
        case "edges.remove": {
          const idsToRemove = new Set(mutation.ids);
          setEdges((eds) => {
            const updated = eds.filter((e) => !idsToRemove.has(e.id));
            save(nodes, updated);
            return updated;
          });
          break;
        }
        case "layout.arrange": {
          setLayoutMode(mutation.direction);
          setNodes((nds) => {
            const arranged =
              mutation.direction === "zone"
                ? computeZoneLayout(nds)
                : computeDagreLayout(nds, edges, mutation.direction);
            save(arranged, edges);
            return arranged;
          });
          break;
        }
      }
    },
    [edges, nodes, save, setNodes, setEdges, modelDefaults, setLayoutMode],
  );

  const handleAutoArrange = useCallback(async () => {
    if (layoutMode === "zone") {
      try {
        const res = await autoWireMutation.mutateAsync({
          canvas_id: canvasId,
          node_ids: nodes.map((n) => n.id),
        });
        if (res.created?.length) {
          setEdges((eds) => [
            ...eds,
            ...res.created.map((e) => ({
              id: e.id,
              source: e.source,
              target: e.target,
              sourceHandle: e.sourceHandle ?? undefined,
              targetHandle: e.targetHandle ?? undefined,
            })),
          ]);
        }
      } catch {
        // best-effort
      }
    }
    setNodes((nds) => {
      const arranged =
        layoutMode === "zone"
          ? computeZoneLayout(nds)
          : computeDagreLayout(nds, edges, layoutMode);
      save(arranged, edges);
      return arranged;
    });
  }, [autoWireMutation, canvasId, edges, layoutMode, nodes, save, setEdges, setNodes]);

  const handleBatchGenerate = useCallback(async () => {
    const runnable = new Set(nodes.filter((n) => RUNNABLE_TYPES.has(n.type ?? "")).map((n) => n.id));
    const incoming = new Map<string, string[]>();
    for (const n of nodes) incoming.set(n.id, []);
    for (const e of edges) {
      if (!incoming.has(e.target)) incoming.set(e.target, []);
      incoming.get(e.target)!.push(e.source);
    }

    const queue: string[] = [];
    const inDegree = new Map<string, number>();
    for (const n of nodes) {
      const deg = (incoming.get(n.id) ?? []).filter((src) => runnable.has(src)).length;
      inDegree.set(n.id, deg);
      if (deg === 0 && runnable.has(n.id)) queue.push(n.id);
    }

    const order: string[] = [];
    while (queue.length > 0) {
      const id = queue.shift()!;
      order.push(id);
      for (const e of edges) {
        if (e.source === id && runnable.has(e.target)) {
          const deg = (inDegree.get(e.target) ?? 1) - 1;
          inDegree.set(e.target, deg);
          if (deg === 0) queue.push(e.target);
        }
      }
    }
    for (const n of nodes) {
      if (runnable.has(n.id) && !order.includes(n.id)) order.push(n.id);
    }

    for (const nodeId of order) {
      try {
        await runNode(nodeId);
      } catch {
        // continue
      }
    }
  }, [nodes, edges, runNode]);

  const handleDeleteNode = useCallback(
    (nodeId: string) => {
      snapshot(nodes, edges);
      const next = removeNodeFromGraph(nodes, edges, nodeId);
      setNodes(next.nodes);
      setEdges(next.edges);
      save(next.nodes, next.edges);
      setSelectedNode(null);
    },
    [nodes, edges, save, setNodes, setEdges, snapshot],
  );

  const handleUpdateNodeData = useCallback(
    (nodeId: string, key: string, value: unknown) => {
      setNodes((nds) => {
        const updated = nds.map((n) =>
          n.id === nodeId ? { ...n, data: { ...n.data, [key]: value } } : n,
        );
        save(updated, edges);
        return updated;
      });
      setSelectedNode((prev) =>
        prev?.id === nodeId ? { ...prev, data: { ...prev.data, [key]: value } } : prev,
      );
    },
    [edges, save, setNodes],
  );

  const handleCopyNode = useCallback(
    (nodeId: string) => {
      const node = nodes.find((n) => n.id === nodeId);
      if (!node) return;
      const newNode = copyNode(node);
      const updatedNodes = [...nodes, newNode];
      setNodes(updatedNodes);
      save(updatedNodes, edges);
    },
    [nodes, edges, save, setNodes],
  );

  const handleContextAutoLayout = useCallback(() => {
    const layouted = computeDagreLayout(nodes, edges, "LR");
    setNodes(layouted);
  }, [nodes, edges, setNodes]);

  const clipboardRef = useRef<NodeClipboard | null>(null);
  const [recentNodeIds, setRecentNodeIds] = useState<string[]>([]);

  const focusNode = useCallback((nodeId: string) => {
    setNodes((nds) => nds.map((n) => ({ ...n, selected: n.id === nodeId })));
    canvasFocusRequest.current?.(nodeId);
  }, [setNodes]);

  const addDownstreamImageNode = useCallback(
    (sourceNodeId: string) => {
      const source = nodes.find((n) => n.id === sourceNodeId);
      if (!source) return;
      snapshot(nodes, edges);
      const newNode: Node = {
        id: crypto.randomUUID(),
        type: "image",
        position: {
          x: source.position.x + (source.measured?.width ?? 280) + 60,
          y: source.position.y,
        },
        data: {
          prompt: "",
          modelId: modelDefaults.imageModelId ?? FALLBACK_IMAGE_MODEL_ID,
          size: "1024x1024",
          status: "idle",
        },
      };
      const newEdge: Edge = {
        id: crypto.randomUUID(),
        source: sourceNodeId,
        target: newNode.id,
        sourceHandle: "output",
        targetHandle: "reference",
      };
      const nextNodes = [...nodes, newNode];
      const nextEdges = [...edges, newEdge];
      setNodes(nextNodes);
      setEdges(nextEdges);
      save(nextNodes, nextEdges);
    },
    [nodes, edges, snapshot, setNodes, setEdges, save, modelDefaults.imageModelId],
  );

  const copySelection = useCallback(() => {
    const clipboard = copySelectedToClipboard(nodes, edges);
    if (clipboard.nodes.length > 0) clipboardRef.current = clipboard;
  }, [nodes, edges]);

  const pasteClipboard = useCallback(() => {
    const clipboard = clipboardRef.current;
    if (!clipboard || clipboard.nodes.length === 0) return;
    snapshot(nodes, edges);
    const { nodes: pastedNodes, edges: pastedEdges } = instantiateClipboard(clipboard);
    const nextNodes = [...nodes.map((n) => ({ ...n, selected: false })), ...pastedNodes];
    const nextEdges = [...edges, ...pastedEdges];
    setNodes(nextNodes);
    setEdges(nextEdges);
    save(nextNodes, nextEdges);
  }, [nodes, edges, snapshot, setNodes, setEdges, save]);

  const handleAlignNodes = useCallback(
    (mode: AlignMode) => {
      const aligned = alignSelectedNodes(nodes, mode);
      if (aligned === nodes) return;
      snapshot(nodes, edges);
      setNodes(aligned);
      save(aligned, edges);
    },
    [nodes, edges, snapshot, setNodes, save],
  );

  const handleDistributeNodes = useCallback(
    (mode: DistributeMode) => {
      const distributed = distributeSelectedNodes(nodes, mode);
      if (distributed === nodes) return;
      snapshot(nodes, edges);
      setNodes(distributed);
      save(distributed, edges);
    },
    [nodes, edges, snapshot, setNodes, save],
  );

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isInput =
        target?.tagName === "INPUT" ||
        target?.tagName === "TEXTAREA" ||
        target?.tagName === "SELECT" ||
        target?.isContentEditable === true;
      const mod = event.ctrlKey || event.metaKey;

      if ((event.key === "Delete" || event.key === "Backspace") && selectedNode && !isInput) {
        event.preventDefault();
        handleDeleteNode(selectedNode.id);
        return;
      }
      if (event.key === "Escape") setSelectedNode(null);
      if (mod && event.key.toLowerCase() === "s") {
        event.preventDefault();
        save(nodes, edges);
        return;
      }
      if (mod && event.key.toLowerCase() === "z") {
        event.preventDefault();
        if (event.shiftKey) handleRedo();
        else handleUndo();
        return;
      }
      if (isInput) return;

      if (mod && event.key.toLowerCase() === "c") {
        copySelection();
        return;
      }
      if (mod && event.key.toLowerCase() === "v") {
        pasteClipboard();
        return;
      }
      if (mod && event.key.toLowerCase() === "d") {
        event.preventDefault();
        copySelection();
        pasteClipboard();
        return;
      }
      if (mod && event.key.toLowerCase() === "a") {
        event.preventDefault();
        setNodes((nds) => nds.map((n) => ({ ...n, selected: true })));
        return;
      }
      if (event.key.startsWith("Arrow")) {
        if (!nodes.some((n) => n.selected)) return;
        event.preventDefault();
        if (!event.repeat) snapshot(nodes, edges);
        const step = event.shiftKey ? 1 : 20;
        const dx = event.key === "ArrowLeft" ? -step : event.key === "ArrowRight" ? step : 0;
        const dy = event.key === "ArrowUp" ? -step : event.key === "ArrowDown" ? step : 0;
        const nextNodes = nodes.map((n) =>
          n.selected
            ? { ...n, position: { x: n.position.x + dx, y: n.position.y + dy } }
            : n,
        );
        setNodes(nextNodes);
        save(nextNodes, edges);
      }
    },
    [
      selectedNode,
      handleDeleteNode,
      nodes,
      edges,
      save,
      handleUndo,
      handleRedo,
      copySelection,
      pasteClipboard,
      setNodes,
    ],
  );

  const handleNodesChange = useCallback(
    (changes: NodeChange<Node>[]) => {
      const hasPositionChange = changes.some((c) => c.type === "position" && c.dragging === true);
      const hasRemove = changes.some((c) => c.type === "remove");
      if (hasPositionChange || hasRemove) snapshot(nodes, edges);
      onNodesChange(changes);
      const isDragEnd = changes.some((c) => c.type === "position" && c.dragging === false);
      if (isDragEnd || hasRemove) save(applyNodeChanges(changes, nodes), edges);
    },
    [onNodesChange, nodes, edges, save, snapshot],
  );

  const handleEdgesChange = useCallback(
    (changes: EdgeChange<Edge>[]) => {
      const hasRemove = changes.some((c) => c.type === "remove");
      if (hasRemove) snapshot(nodes, edges);
      onEdgesChange(changes);
      if (hasRemove) save(nodes, applyEdgeChanges(changes, edges));
    },
    [onEdgesChange, nodes, edges, save, snapshot],
  );

  const handleConnect = useCallback(
    (connection: Connection) => {
      snapshot(nodes, edges);
      const edge: Edge = {
        id: crypto.randomUUID(),
        source: connection.source,
        target: connection.target,
        sourceHandle: connection.sourceHandle ?? undefined,
        targetHandle: connection.targetHandle ?? undefined,
      };
      const newEdges = [...edges, edge];
      setEdges(newEdges);
      save(nodes, newEdges);
    },
    [edges, nodes, save, setEdges, snapshot],
  );

  const handleNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    setSelectedNode(node);
    setRightPanelTab("inspector");
  }, []);

  const handlePaneClick = useCallback(() => {
    setSelectedNode(null);
    setCtxMenu(null);
  }, []);

  const handleNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setCtxMenu({ x: event.clientX, y: event.clientY, nodeId: node.id });
  }, []);

  const handlePaneContextMenu = useCallback((event: MouseEvent | React.MouseEvent) => {
    event.preventDefault();
    const clientX = "clientX" in event ? event.clientX : 0;
    const clientY = "clientY" in event ? event.clientY : 0;
    setCtxMenu({ x: clientX, y: clientY });
  }, []);

  const handleDragOver = useCallback((event: DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
  }, []);

  const handleFileDrop = useCallback(
    async (file: File, clientX: number, clientY: number) => {
      if (!file.type.startsWith("image/")) return;
      setUploading(true);
      try {
        const req = await requestUpload.mutateAsync({
          mime_type: file.type as "image/png" | "image/jpeg" | "image/webp",
          size_bytes: file.size,
        });
        await fetch(req.upload_url, {
          method: "PUT",
          body: file,
          headers: { "Content-Type": file.type },
        });
        const buf = await file.arrayBuffer();
        const hash = await crypto.subtle.digest("SHA-256", buf);
        const sha256 = Array.from(new Uint8Array(hash))
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");
        const dims = await new Promise<{ w: number; h: number }>((resolve) => {
          const img = new Image();
          img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
          img.src = URL.createObjectURL(file);
        });
        await confirmUpload.mutateAsync({
          asset_id: req.asset_id,
          sha256,
          width: dims.w,
          height: dims.h,
        });
        const position = { x: clientX - 100, y: clientY - 40 };
        const newNode: Node = {
          id: crypto.randomUUID(),
          type: "image",
          position,
          data: {
            prompt: `参考图: ${file.name}`,
            modelId: modelDefaults.imageModelId ?? FALLBACK_IMAGE_MODEL_ID,
            size: "1024x1024",
            referenceAssetIds: [req.asset_id],
            status: "idle",
          },
        };
        setNodes((nds) => {
          const updated = [...nds, newNode];
          save(updated, edges);
          return updated;
        });
      } catch (err) {
        console.error("[canvas] File upload failed:", err);
      } finally {
        setUploading(false);
      }
    },
    [confirmUpload, edges, modelDefaults.imageModelId, requestUpload, save, setNodes],
  );

  // LibTV-style quick add: shared by palette drag-drop and canvas dbl-click.
  const addNodeAt = useCallback(
    (nodeType: CanvasNodeType, position: { x: number; y: number }, kind?: string): Node => {
      const newNode: Node = {
        id: crypto.randomUUID(),
        type: nodeType,
        position,
        data: getDefaultNodeData(nodeType, modelDefaults, kind),
      };
      setNodes((nds) => {
        const updated = [...nds, newNode];
        save(updated, edges);
        return updated;
      });
      return newNode;
    },
    [edges, modelDefaults, save, setNodes],
  );

  const handleDrop = useCallback(
    async (event: DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData("application/reactflow-type") as CanvasNodeType | "";
      if (nodeType && nodeType in canvasNodeTypes) {
        const position = canvasFlowBridge.screenToFlow
          ? canvasFlowBridge.screenToFlow({ x: event.clientX, y: event.clientY })
          : { x: event.clientX - 100, y: event.clientY - 40 };
        const kind = event.dataTransfer.getData("application/reactflow-kind") || undefined;
        addNodeAt(nodeType, position, kind);
        return;
      }
      const files = event.dataTransfer.files;
      if (files.length > 0) {
        await handleFileDrop(files[0], event.clientX, event.clientY);
      }
    },
    [addNodeAt, handleFileDrop],
  );

  const value = useMemo<CanvasContextValue>(
    () => ({
      canvasId,
      defaultTextModelId,
      initialPrompt,
      initialMode,
      modelDefaults,
      isLoading,
      isError,
      error,
      refetch,
      nodes,
      setNodes,
      edges,
      setEdges,
      handleEdgesChange,
      canvasName,
      initialViewport,
      selectedNode,
      setSelectedNode,
      rightPanelTab,
      setRightPanelTab,
      runNode,
      isRunning,
      nodeRunStates,
      save,
      stats,
      layoutMode,
      setLayoutMode,
      scrollMode,
      handleScrollModeChange,
      uploading,
      canUndo,
      canRedo,
      handleUndo,
      handleRedo,
      handleAutoArrange,
      handleBatchGenerate,
      handleRunDirty,
      dirtyRunning: runDirtyMutation.isPending,
      handleOpenWorkbench,
      workbenchLoading: createWorkbench.isPending,
      runnableCount,
      handleDeleteNode,
      handleUpdateNodeData,
      handleCanvasMutation,
      handleTemplateInstantiated,
      handleNodesChange,
      handleConnect,
      handleNodeClick,
      handlePaneClick,
      handleNodeContextMenu,
      handlePaneContextMenu,
      handleInteractionStart,
      handleInteractionEnd,
      handleKeyDown,
      handleDragOver,
      handleDrop,
      addNodeAt,
      selectedNodeIds,
      handleAutoWire,
      autoWirePending: autoWireMutation.isPending,
      ctxMenu,
      setCtxMenu,
      workbenchId,
      setWorkbenchId,
      handleCopyNode,
      handleContextAutoLayout,
      handleAlignNodes,
      handleDistributeNodes,
      peers,
      recentNodeIds,
      focusNode,
      addDownstreamImageNode,
      autoPipelineState,
      startAutoPipeline,
      cancelAutoPipeline,
      retryFailed: retryFailedPipeline,
      autoPipelineStarting,
    }),
    [
      canvasId,
      defaultTextModelId,
      initialPrompt,
      initialMode,
      modelDefaults,
      isLoading,
      isError,
      error,
      refetch,
      nodes,
      setNodes,
      edges,
      setEdges,
      handleEdgesChange,
      canvasName,
      initialViewport,
      selectedNode,
      rightPanelTab,
      runNode,
      isRunning,
      nodeRunStates,
      save,
      stats,
      layoutMode,
      scrollMode,
      handleScrollModeChange,
      uploading,
      canUndo,
      canRedo,
      handleUndo,
      handleRedo,
      handleAutoArrange,
      handleBatchGenerate,
      handleRunDirty,
      runDirtyMutation.isPending,
      handleOpenWorkbench,
      createWorkbench.isPending,
      runnableCount,
      handleDeleteNode,
      handleUpdateNodeData,
      handleCanvasMutation,
      handleTemplateInstantiated,
      handleNodesChange,
      handleConnect,
      handleNodeClick,
      handlePaneClick,
      handleNodeContextMenu,
      handlePaneContextMenu,
      handleInteractionStart,
      handleInteractionEnd,
      handleKeyDown,
      handleDragOver,
      handleDrop,
      selectedNodeIds,
      handleAutoWire,
      autoWireMutation.isPending,
      ctxMenu,
      workbenchId,
      handleCopyNode,
      handleContextAutoLayout,
      handleAlignNodes,
      handleDistributeNodes,
      peers,
      recentNodeIds,
      focusNode,
      addDownstreamImageNode,
      autoPipelineState,
      startAutoPipeline,
      cancelAutoPipeline,
      retryFailedPipeline,
      autoPipelineStarting,
    ],
  );

  return <CanvasContext.Provider value={value}>{children}</CanvasContext.Provider>;
}

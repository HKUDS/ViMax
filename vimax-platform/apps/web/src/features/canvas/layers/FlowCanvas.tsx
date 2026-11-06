"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  BackgroundVariant,
  PanOnScrollMode,
  ViewportPortal,
  useReactFlow,
  useNodes,
  type Connection,
  type Edge,
  type FinalConnectionState,
  type Viewport,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalDistributeCenter,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalDistributeCenter,
  GitBranch,
  Loader2,
} from "lucide-react";
import { cn } from "@vimax/ui";
import type { CanvasNodeType } from "@vimax/contracts";
import { isValidConnectionType } from "@vimax/contracts";
import { NODE_TYPE_VISUALS } from "../constants/node-visuals";
import { Wand2, Plus, Layers, Grid3x3, Sparkles, UserRound, AudioLines } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { toast } from "sonner";
import { TemplatePicker } from "../panels/TemplatePicker";
import { ZoneBackgroundLayer } from "../ZoneBackgroundLayer";
import { canvasNodeTypes, CANVAS_MAX_ZOOM, CANVAS_MIN_ZOOM } from "../constants/canvas-flow";
import { NODE_TYPE_HEX } from "../constants/node-visuals";
import { EDGE_RELATION_LEGEND, withEdgeVisuals } from "../constants/edge-relations";
import { useCanvas, canvasFocusRequest, canvasFlowBridge } from "../canvas-context";
import { sharedCanvasWs } from "@/lib/websocket/shared-ws";
import type { AlignMode, DistributeMode } from "../utils/align";

const ALIGN_BUTTONS: { mode: AlignMode; icon: typeof AlignStartVertical; title: string }[] = [
  { mode: "left", icon: AlignStartVertical, title: "左对齐" },
  { mode: "hcenter", icon: AlignCenterVertical, title: "水平居中" },
  { mode: "right", icon: AlignEndVertical, title: "右对齐" },
  { mode: "top", icon: AlignStartHorizontal, title: "顶对齐" },
  { mode: "vcenter", icon: AlignCenterHorizontal, title: "垂直居中" },
  { mode: "bottom", icon: AlignEndHorizontal, title: "底对齐" },
];

const DISTRIBUTE_BUTTONS: { mode: DistributeMode; icon: typeof AlignStartVertical; title: string }[] = [
  { mode: "horizontal", icon: AlignHorizontalDistributeCenter, title: "水平等距" },
  { mode: "vertical", icon: AlignVerticalDistributeCenter, title: "垂直等距" },
];

/** Shift+1 fits the whole graph, Shift+2 zooms to the current selection. */
function FlowShortcuts() {
  const { fitView } = useReactFlow();
  const nodes = useNodes();

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.shiftKey || (event.key !== "1" && event.key !== "2")) return;
      const target = event.target as HTMLElement | null;
      if (target?.tagName === "INPUT" || target?.tagName === "TEXTAREA") return;
      event.preventDefault();
      if (event.key === "1") {
        void fitView({ duration: 300, padding: 0.2 });
        return;
      }
      const selected = nodes.filter((n) => n.selected);
      if (selected.length > 0) {
        void fitView({ duration: 300, padding: 0.2, nodes: selected });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [fitView, nodes]);

  return null;
}

/** Legend for the edge relation colors (LibTV-style workflow semantics). */
function EdgeRelationLegend() {
  const { edges } = useCanvas();
  if (edges.length === 0) return null;
  return (
    <div className="pointer-events-none absolute bottom-[120px] left-3 z-10 flex flex-col gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]/85 px-2.5 py-2 shadow-sm backdrop-blur">
      {EDGE_RELATION_LEGEND.map(({ relation, label, stroke }) => (
        <span key={relation} className="flex items-center gap-1.5 text-[10px] text-[var(--color-text-muted)]">
          <svg width="18" height="4" aria-hidden>
            <line
              x1="0" y1="2" x2="18" y2="2"
              stroke={stroke}
              strokeWidth="2"
              strokeDasharray="5 4"
              style={{ animation: "vimax-edge-flow 3.5s linear infinite" }}
            />
          </svg>
          {label}
        </span>
      ))}
    </div>
  );
}

/** Render remote peers' cursors in flow coordinates (viewport-transformed). */function PeerCursors() {
  const { peers } = useCanvas();
  return (
    <ViewportPortal>
      {Object.entries(peers).map(([userId, peer]) =>
        peer.cursor ? (
          <div
            key={userId}
            style={{
              position: "absolute",
              transform: `translate(${peer.cursor.x}px, ${peer.cursor.y}px)`,
              pointerEvents: "none",
              zIndex: 50,
              display: "flex",
              alignItems: "flex-start",
              gap: 2,
            }}
          >
            <svg width="14" height="18" viewBox="0 0 14 18" style={{ filter: "drop-shadow(0 1px 2px rgba(0,0,0,0.4))" }}>
              <path d="M1 1 L13 8 L7 9.5 L4.5 16 Z" fill={peer.color} stroke="#fff" strokeWidth="1" />
            </svg>
            <span
              style={{
                marginTop: 14,
                background: peer.color,
                color: "#fff",
                fontSize: 10,
                lineHeight: "16px",
                padding: "1px 7px",
                borderRadius: 4,
                whiteSpace: "nowrap",
                fontWeight: 600,
              }}
            >
              {peer.name}
            </span>
          </div>
        ) : null,
      )}
    </ViewportPortal>
  );
}

/**
 * LibTV-style quick node menu: shown on canvas double-click or when a
 * connection is dropped on empty canvas. Lists node types valid for the
 * connection source (or all types when created from scratch).
 */
function QuickNodeMenu({
  x,
  y,
  sourceType,
  onPick,
  onClose,
}: {
  x: number;
  y: number;
  sourceType: string | null;
  onPick: (type: CanvasNodeType) => void;
  onClose: () => void;
}) {
  useEffect(() => {
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-quick-node-menu]")) onClose();
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  const types = (Object.keys(NODE_TYPE_VISUALS) as CanvasNodeType[]).filter(
    (t) => !sourceType || isValidConnectionType(sourceType, t),
  );
  const left = Math.min(x, window.innerWidth - 190);
  const top = Math.min(y, window.innerHeight - (46 + types.length * 34));

  return (
    <div
      data-quick-node-menu
      className="fixed z-50 w-[172px] overflow-hidden rounded-xl border border-[var(--color-hairline-strong)] bg-[var(--color-surface-2)] py-1 shadow-lg"
      style={{ left, top }}
    >
      <div className="px-3 pb-1 pt-1.5 text-[10px] font-medium text-[var(--color-ink-tertiary)]">
        添加节点
      </div>
      {types.map((type) => {
        const visual = NODE_TYPE_VISUALS[type];
        const Icon = visual.icon;
        return (
          <button
            key={type}
            type="button"
            onClick={() => onPick(type)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-3)]"
          >
            <span
              className="flex size-5 shrink-0 items-center justify-center rounded-md"
              style={{
                backgroundColor: `color-mix(in srgb, var(${visual.colorVar}) 16%, transparent)`,
                color: `var(${visual.colorVar})`,
              }}
            >
              <Icon size={11} />
            </span>
            {visual.label}
          </button>
        );
      })}
    </div>
  );
}

// ── Node ability menu ("/" trigger, LibTV parity) ───────────────────
// Surfaces the per-node pro abilities (variants, multi-camera grid,
// story push, character views, SFX) directly on the canvas instead of
// burying them in the inspector.

interface NodeAbility {
  label: string;
  icon: typeof Wand2;
  invoke: () => Promise<unknown>;
}

function NodeAbilityMenu({
  canvasId,
  nodeId,
  nodeType,
  onDone,
  onClose,
}: {
  canvasId: string;
  nodeId: string;
  nodeType: string;
  onDone: () => void;
  onClose: () => void;
}) {
  const runVariantsMut = trpc.canvas.runVariants.useMutation();
  const multiCameraMut = trpc.canvas.runMultiCameraGrid.useMutation();
  const storyPushMut = trpc.canvas.runStoryPush.useMutation();
  const audioGenMut = trpc.canvas.runAudioGeneration.useMutation();
  const charViewMut = trpc.canvas.runCharacterView.useMutation();

  const abilities: NodeAbility[] = [];
  if (nodeType === "image") {
    abilities.push({
      label: "变体择优 ×4",
      icon: Layers,
      invoke: () => runVariantsMut.mutateAsync({ canvas_id: canvasId, node_id: nodeId, count: 4 }),
    });
  }
  if (nodeType === "shot") {
    abilities.push(
      { label: "多机位宫格 3×3", icon: Grid3x3, invoke: () => multiCameraMut.mutateAsync({ canvas_id: canvasId, node_id: nodeId, grid_size: "3x3" }) },
      { label: "剧情推演 4 宫格", icon: Sparkles, invoke: () => storyPushMut.mutateAsync({ canvas_id: canvasId, node_id: nodeId }) },
      { label: "生成音效", icon: AudioLines, invoke: () => audioGenMut.mutateAsync({ canvas_id: canvasId, node_id: nodeId }) },
    );
  }
  if (nodeType === "character") {
    abilities.push({
      label: "角色三视图",
      icon: UserRound,
      invoke: () => charViewMut.mutateAsync({ canvas_id: canvasId, node_id: nodeId, view: "front" }),
    });
  }

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onPointerDown = (e: PointerEvent) => {
      if (!(e.target as HTMLElement).closest?.("[data-ability-menu]")) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onClose]);

  if (abilities.length === 0) return null;

  const el = document.querySelector(`.react-flow__node[data-id="${nodeId}"]`);
  const rect = el?.getBoundingClientRect();
  const left = rect ? Math.min(rect.right + 8, window.innerWidth - 210) : 200;
  const top = rect ? rect.top : 200;

  const run = (ability: NodeAbility) => {
    ability
      .invoke()
      .then(() => toast.success(`${ability.label} 已加入队列`))
      .catch((err: unknown) =>
        toast.error(`${ability.label} 失败: ${(err as Error).message.slice(0, 60)}`),
      );
    onDone();
  };

  return (
    <div
      data-ability-menu
      className="fixed z-50 w-[190px] overflow-hidden rounded-xl border border-[var(--color-hairline-strong)] bg-[var(--color-surface-2)] py-1 shadow-lg"
      style={{ left, top }}
    >
      <div className="flex items-center gap-1.5 px-3 pb-1 pt-1.5 text-[10px] font-medium text-[var(--color-ink-tertiary)]">
        <Wand2 className="size-3" /> 节点能力 · 按 / 唤出
      </div>
      {abilities.map((ability) => {
        const Icon = ability.icon;
        return (
          <button
            key={ability.label}
            type="button"
            onClick={() => run(ability)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-[var(--color-ink)] transition-colors hover:bg-[var(--color-surface-3)]"
          >
            <Icon className="size-3.5 shrink-0 text-[var(--color-accent)]" />
            {ability.label}
          </button>
        );
      })}
    </div>
  );
}

function FlowCanvasInner() {
  const {
    canvasId,
    nodes,
    edges,
    save,
    initialViewport,
    layoutMode,
    scrollMode,
    handleNodesChange,
    handleEdgesChange,
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
    setEdges,
    selectedNodeIds,
    handleAutoWire,
    autoWirePending,
    handleTemplateInstantiated,
    handleAlignNodes,
    handleDistributeNodes,
    peers,
  } = useCanvas();

  const { screenToFlowPosition, setCenter, getZoom, getNodes } = useReactFlow();
  const [quickMenu, setQuickMenu] = useState<{
    x: number;
    y: number;
    flow: { x: number; y: number };
    source: { id: string; type: string } | null;
  } | null>(null);

  const [abilityNode, setAbilityNode] = useState<{ id: string; type: string } | null>(null);

  // "/" on a selected node opens its ability menu (LibTV parity).
  const handleKeyDownCapture = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key !== "/") return;
      const t = event.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable) return;
      const selId = selectedNodeIds[0];
      if (!selId) return;
      const node = nodes.find((n) => n.id === selId);
      if (!node?.type || !(node.type in NODE_TYPE_VISUALS)) return;
      event.preventDefault();
      setAbilityNode({ id: node.id, type: node.type ?? "" });
    },
    [nodes, selectedNodeIds],
  );

  // LibTV pattern: double-click empty canvas to create a node here.
  // Native capture listener: React Flow stops dblclick bubbling inside the
  // pane, so React's delegated handler never sees it.
  const paneRef = useRef<HTMLDivElement | null>(null);
  const handlePaneDoubleClick = useCallback(
    (event: MouseEvent) => {
      const target = event.target as HTMLElement;
      if (!target.classList.contains("react-flow__pane")) return;
      const flow = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      setQuickMenu({ x: event.clientX, y: event.clientY, flow, source: null });
    },
    [screenToFlowPosition],
  );

  useEffect(() => {
    const el = paneRef.current;
    if (!el) return;
    el.addEventListener("dblclick", handlePaneDoubleClick, true);
    return () => el.removeEventListener("dblclick", handlePaneDoubleClick, true);
  }, [handlePaneDoubleClick]);

  // LibTV pattern: drop a connection on empty canvas to spawn a downstream
  // node that is auto-wired to the source.
  const handleConnectEnded = useCallback(
    (event: MouseEvent | TouchEvent, state: FinalConnectionState) => {
      if (!state.fromNode?.type || state.toHandle) return;
      const p =
        "clientX" in event
          ? { x: event.clientX, y: event.clientY }
          : { x: event.changedTouches[0].clientX, y: event.changedTouches[0].clientY };
      const target = event.target as HTMLElement;
      if (!target.classList?.contains?.("react-flow__pane")) return;
      const flow = screenToFlowPosition(p);
      setQuickMenu({
        x: p.x,
        y: p.y,
        flow,
        source: { id: state.fromNode.id, type: state.fromNode.type },
      });
    },
    [screenToFlowPosition],
  );

  const handleQuickNodePick = useCallback(
    (type: CanvasNodeType) => {
      if (!quickMenu) return;
      const node = addNodeAt(type, { x: quickMenu.flow.x - 110, y: quickMenu.flow.y - 30 });
      if (quickMenu.source) {
        const newEdge: Edge = {
          id: crypto.randomUUID(),
          source: quickMenu.source.id,
          target: node.id,
          ...(type === "video" ? { targetHandle: "first_frame" } : {}),
        };
        setEdges((eds) => [...eds, newEdge]);
      }
      setQuickMenu(null);
    },
    [addNodeAt, quickMenu, setEdges],
  );


  // Relation semantics + flow animation are derived at render time from
  // the live node graph, so every edge source (snapshot, auto-wire, chat
  // mutations, manual connects) gets consistent visuals for free.
  const visualEdges = useMemo(
    () => withEdgeVisuals(edges, nodes),
    [edges, nodes],
  );

  // ── Presence: send local pointer (throttled) + heartbeat ──
  const lastPresenceSend = useRef(0);
  const presenceState = useRef<{ cursor: { x: number; y: number } | null; selected: string[] }>({
    cursor: null,
    selected: [],
  });

  useEffect(() => {
    presenceState.current.selected = selectedNodeIds;
  }, [selectedNodeIds]);

  const handlePointerMove = useCallback(
    (event: React.PointerEvent) => {
      if (!sharedCanvasWs.connected) return;
      const now = Date.now();
      if (now - lastPresenceSend.current < 50) return;
      lastPresenceSend.current = now;
      const cursor = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      presenceState.current.cursor = cursor;
      sharedCanvasWs.send({
        type: "canvas.presence",
        canvasId,
        cursor,
        selectedNodeIds: presenceState.current.selected,
      });
    },
    [canvasId, screenToFlowPosition],
  );

  useEffect(() => {
    const heartbeat = setInterval(() => {
      if (!sharedCanvasWs.connected) return;
      sharedCanvasWs.send({
        type: "canvas.presence",
        canvasId,
        cursor: presenceState.current.cursor,
        selectedNodeIds: presenceState.current.selected,
      });
    }, 5_000);
    return () => clearInterval(heartbeat);
  }, [canvasId]);

  // ── Focus requests from chat panel / provider ──
  useEffect(() => {
    canvasFocusRequest.current = (nodeId: string) => {
      const node = getNodes().find((n) => n.id === nodeId);
      if (!node) return;
      setCenter(
        node.position.x + (node.measured?.width ?? 280) / 2,
        node.position.y + (node.measured?.height ?? 140) / 2,
        { zoom: Math.max(getZoom(), 1), duration: 400 },
      );
    };
    canvasFlowBridge.screenToFlow = (p) => screenToFlowPosition(p);
    return () => {
      canvasFocusRequest.current = null;
      canvasFlowBridge.screenToFlow = null;
    };
  }, [getNodes, setCenter, getZoom, screenToFlowPosition]);

  const handleMoveEnd = useCallback(
    (_event: unknown, viewport: Viewport) => {
      handleInteractionEnd();
      save(nodes, edges, viewport);
    },
    [handleInteractionEnd, save, nodes, edges],
  );

  // A saved viewport (non-default) wins over auto-fit so users return to
  // where they left off; fresh canvases still fit on mount.
  const hasSavedViewport =
    initialViewport.x !== 0 || initialViewport.y !== 0 || initialViewport.zoom !== 1;

  return (
    <div
      className="relative h-full flex-1 outline-none"
      tabIndex={-1}
      ref={paneRef}
      onKeyDownCapture={handleKeyDownCapture}
      onKeyDown={handleKeyDown}
      onPointerMove={handlePointerMove}
      onDragOver={handleDragOver}
      onDrop={(e) => void handleDrop(e)}
    >
      <TemplatePicker canvasId={canvasId} onInstantiated={handleTemplateInstantiated} />

      {selectedNodeIds.length >= 2 && (
        <>
          <button
            type="button"
            onClick={() => void handleAutoWire()}
            disabled={autoWirePending}
            title="按类型依赖自动连线选中节点"
            className={cn(
              "absolute left-1/2 top-3 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-lg border border-[var(--color-accent)] bg-[var(--color-accent)] px-3.5 py-1.5 text-xs font-semibold text-[var(--color-accent-on)] shadow-lg",
              autoWirePending && "cursor-wait opacity-80",
            )}
          >
            {autoWirePending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <GitBranch className="size-3.5" />
            )}
            自动连线 ({selectedNodeIds.length})
          </button>

          <div className="absolute left-1/2 top-12 z-20 flex -translate-x-1/2 items-center gap-0.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-1 shadow-lg">
            {ALIGN_BUTTONS.map(({ mode, icon: Icon, title }) => (
              <button
                key={mode}
                type="button"
                title={title}
                onClick={() => handleAlignNodes(mode)}
                className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
              >
                <Icon className="size-3.5" />
              </button>
            ))}
            <span className="mx-0.5 h-4 w-px bg-[var(--color-border)]" />
            {DISTRIBUTE_BUTTONS.map(({ mode, icon: Icon, title }) => (
              <button
                key={mode}
                type="button"
                title={title}
                onClick={() => handleDistributeNodes(mode)}
                className="rounded p-1.5 text-[var(--color-text-muted)] hover:bg-[var(--color-border)] hover:text-[var(--color-text)]"
              >
                <Icon className="size-3.5" />
              </button>
            ))}
          </div>
        </>
      )}

      <ReactFlow
        nodes={nodes}
        edges={visualEdges}
        onNodesChange={handleNodesChange}
        onEdgesChange={handleEdgesChange}
        onConnect={handleConnect}
        onMoveEnd={handleMoveEnd}
        onConnectEnd={handleConnectEnded}
        zoomOnDoubleClick={false}
        onNodeClick={handleNodeClick}
        onNodeContextMenu={handleNodeContextMenu}
        onPaneClick={handlePaneClick}
        onPaneContextMenu={handlePaneContextMenu}
        onNodeDragStart={handleInteractionStart}
        onNodeDragStop={handleInteractionEnd}
        onMoveStart={handleInteractionStart}
        nodeTypes={canvasNodeTypes}
        minZoom={CANVAS_MIN_ZOOM}
        maxZoom={CANVAS_MAX_ZOOM}
        defaultViewport={initialViewport}
        fitView={!hasSavedViewport}
        panOnDrag={[0, 1]}
        panOnScroll={scrollMode === "pan"}
        panOnScrollMode={PanOnScrollMode.Free}
        snapToGrid
        snapGrid={[20, 20]}
        isValidConnection={(connection: Edge | Connection) => {
          if (connection.source === connection.target) return false;
          const sourceType = nodes.find((n) => n.id === connection.source)?.type ?? "";
          const targetType = nodes.find((n) => n.id === connection.target)?.type ?? "";
          return isValidConnectionType(sourceType, targetType);
        }}
        style={{ backgroundColor: "var(--color-bg)" }}
      >
        {layoutMode === "zone" && <ZoneBackgroundLayer />}
        <Background variant={BackgroundVariant.Dots} gap={20} size={1} />
        <EdgeRelationLegend />
        <FlowShortcuts />
        <PeerCursors />
        <Controls className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]" />
        <MiniMap
          className="rounded-lg border border-[var(--color-hairline)] bg-[var(--color-surface)]"
          nodeColor={(n) => NODE_TYPE_HEX[n.type as keyof typeof NODE_TYPE_HEX] ?? "#6e6e78"}
          nodeStrokeColor="transparent"
          nodeBorderRadius={4}
        />
      </ReactFlow>

      {abilityNode && (
        <NodeAbilityMenu
          canvasId={canvasId}
          nodeId={abilityNode.id}
          nodeType={abilityNode.type}
          onDone={() => setAbilityNode(null)}
          onClose={() => setAbilityNode(null)}
        />
      )}

      {quickMenu && (
        <QuickNodeMenu
          x={quickMenu.x}
          y={quickMenu.y}
          sourceType={quickMenu.source?.type ?? null}
          onPick={handleQuickNodePick}
          onClose={() => setQuickMenu(null)}
        />
      )}
    </div>
  );
}

export function FlowCanvas() {
  return (
    <ReactFlowProvider>
      <FlowCanvasInner />
    </ReactFlowProvider>
  );
}

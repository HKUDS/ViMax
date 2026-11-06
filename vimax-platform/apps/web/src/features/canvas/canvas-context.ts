import { createContext, useContext } from "react";
import type { DragEvent } from "react";
import type { Connection, Edge, EdgeChange, Node, NodeChange } from "@xyflow/react";
import type { CanvasNodeType } from "@vimax/contracts";
import type {
  CanvasMutation,
  InstantiatedEdge,
  InstantiatedNode,
} from "@vimax/contracts";
import type { useCanvasSave, useCanvasSnapshot } from "./hooks/useCanvasSnapshot";
import type { NodeRunState } from "./hooks/useNodeRun";
import type { useAutoPipeline } from "./hooks/useAutoPipeline";
import type { LayoutMode } from "./constants/canvas-flow";
import type { CanvasStats } from "./toolbar/BottomToolbar";
import type { AlignMode, DistributeMode } from "./utils/align";

/** Another user's live presence on this canvas (from WS presence relay). */
export interface PeerPresence {
  name: string;
  color: string;
  cursor: { x: number; y: number } | null;
  selectedNodeIds: string[];
}

/**
 * Registered by the React Flow layer so non-ReactFlow code (chat panel,
 * provider) can focus a node on the canvas. The flow layer owns the camera.
 */
export const canvasFocusRequest: { current: ((nodeId: string) => void) | null } = {
  current: null,
};

/** Registered by the React Flow layer: screen (client) → flow coordinates. */
export const canvasFlowBridge: {
  screenToFlow: ((point: { x: number; y: number }) => { x: number; y: number }) | null;
} = { screenToFlow: null };

export interface CanvasContextValue {
  canvasId: string;
  defaultTextModelId?: string;
  initialPrompt?: string;
  initialMode?: string;
  modelDefaults: { imageModelId?: string; videoModelId?: string };
  isLoading: boolean;
  isError: boolean;
  error: unknown;
  refetch: () => void;
  nodes: Node[];
  setNodes: React.Dispatch<React.SetStateAction<Node[]>>;
  edges: Edge[];
  setEdges: React.Dispatch<React.SetStateAction<Edge[]>>;
  handleEdgesChange: (changes: EdgeChange<Edge>[]) => void;
  canvasName: string;
  initialViewport: ReturnType<typeof useCanvasSnapshot>["viewport"];
  selectedNode: Node | null;
  setSelectedNode: React.Dispatch<React.SetStateAction<Node | null>>;
  rightPanelTab: "inspector" | "chat";
  setRightPanelTab: React.Dispatch<React.SetStateAction<"inspector" | "chat">>;
  runNode: (nodeId: string) => Promise<unknown>;
  isRunning: boolean;
  nodeRunStates: Record<string, NodeRunState>;
  save: ReturnType<typeof useCanvasSave>["save"];
  stats: CanvasStats;
  layoutMode: LayoutMode;
  setLayoutMode: React.Dispatch<React.SetStateAction<LayoutMode>>;
  scrollMode: "zoom" | "pan";
  handleScrollModeChange: (mode: "zoom" | "pan") => void;
  uploading: boolean;
  canUndo: boolean;
  canRedo: boolean;
  handleUndo: () => void;
  handleRedo: () => void;
  handleAutoArrange: () => Promise<void>;
  handleBatchGenerate: () => Promise<void>;
  handleRunDirty: () => Promise<void>;
  dirtyRunning: boolean;
  handleOpenWorkbench: () => Promise<void>;
  workbenchLoading: boolean;
  runnableCount: number;
  handleDeleteNode: (nodeId: string) => void;
  handleUpdateNodeData: (nodeId: string, key: string, value: unknown) => void;
  handleCanvasMutation: (mutation: CanvasMutation) => void;
  handleTemplateInstantiated: (newNodes: InstantiatedNode[], newEdges: InstantiatedEdge[]) => void;
  handleNodesChange: (changes: NodeChange<Node>[]) => void;
  handleConnect: (connection: Connection) => void;
  handleNodeClick: (_event: React.MouseEvent, node: Node) => void;
  handlePaneClick: () => void;
  handleNodeContextMenu: (event: React.MouseEvent, node: Node) => void;
  handlePaneContextMenu: (event: MouseEvent | React.MouseEvent) => void;
  handleInteractionStart: () => void;
  handleInteractionEnd: () => void;
  handleKeyDown: (event: React.KeyboardEvent) => void;
  handleDragOver: (event: DragEvent) => void;
  handleDrop: (event: DragEvent) => Promise<void>;
  /** Create a node of `type` at a flow-space position (LibTV-style quick add). */
  addNodeAt: (type: CanvasNodeType, position: { x: number; y: number }, kind?: string) => Node;
  selectedNodeIds: string[];
  handleAutoWire: () => Promise<void>;
  autoWirePending: boolean;
  ctxMenu: { x: number; y: number; nodeId?: string } | null;
  setCtxMenu: React.Dispatch<React.SetStateAction<{ x: number; y: number; nodeId?: string } | null>>;
  workbenchId: string | null;
  setWorkbenchId: React.Dispatch<React.SetStateAction<string | null>>;
  handleCopyNode: (nodeId: string) => void;
  handleContextAutoLayout: () => void;
  autoPipelineState: ReturnType<typeof useAutoPipeline>["state"];
  startAutoPipeline: (
    scriptNodeId?: string,
    opts?: { regenerate?: boolean },
  ) => Promise<string | undefined>;
  cancelAutoPipeline: () => void;
  retryFailed: () => void;
  autoPipelineStarting: boolean;
  handleAlignNodes: (mode: AlignMode) => void;
  handleDistributeNodes: (mode: DistributeMode) => void;
  /** Live peers on this canvas (excludes the local user). */
  peers: Record<string, PeerPresence>;
  /** Node ids most recently added by the chat agent (newest last, capped). */
  recentNodeIds: string[];
  focusNode: (nodeId: string) => void;
  /** Insert a downstream image node fed by the given node's output (i2i refine entry). */
  addDownstreamImageNode: (sourceNodeId: string) => void;
}

export const CanvasContext = createContext<CanvasContextValue | null>(null);

export function useCanvas(): CanvasContextValue {
  const ctx = useContext(CanvasContext);
  if (!ctx) throw new Error("useCanvas must be used within CanvasProvider");
  return ctx;
}

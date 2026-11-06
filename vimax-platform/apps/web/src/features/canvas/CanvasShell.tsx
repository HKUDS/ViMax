"use client";

import type { ReactNode } from "react";
import { useState } from "react";
import type { Edge, Node } from "@xyflow/react";
import { ConfirmDialog, cn } from "@vimax/ui";
import { toast } from "sonner";
import { ClipboardList, MessageSquare } from "lucide-react";
import { NodePalette } from "./sidebars/NodePalette";
import { FlowCanvas } from "./layers/FlowCanvas";
import { BottomToolbar } from "./toolbar/BottomToolbar";
import { NodeInspector } from "./panels/NodeInspector";
import { ChatPanel } from "../chat/ChatPanel";
import { useCanvas } from "./canvas-context";

const PIPELINE_STAGE_LABELS: Record<string, string> = {
  storyboard: "分镜",
  characters: "角色",
  shot: "镜头",
  image: "图片",
  video: "视频",
  concat: "合成",
};

// 页面刷新后 WS 管线事件丢失（状态归零），从节点状态推导最深的生产
// 阶段，保证"出片中"始终可见。script 不参与：后续阶段复用该节点，
// 其 running 状态不代表分镜阶段仍在执行。
const PRODUCTION_STAGES: Array<{ label: string; types: string[] }> = [
  { label: "分镜", types: ["storyboard_cell"] },
  { label: "镜头", types: ["shot"] },
  { label: "图片", types: ["image"] },
  { label: "视频", types: ["video"] },
  { label: "合成", types: ["concat"] },
];

function TabButton({
  label,
  icon,
  active,
  onClick,
}: {
  label: string;
  icon: ReactNode;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 border-b border-transparent py-2 text-[11px] transition-colors",
        active
          ? "border-b-[var(--color-accent)] font-semibold text-[var(--color-ink)]"
          : "text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]",
      )}
    >
      {icon}
      {label}
    </button>
  );
}

export function CanvasShell() {
  const {
    canvasId,
    defaultTextModelId,
    initialPrompt,
    initialMode,
    nodes,
    setNodes,
    edges,
    setEdges,
    selectedNode,
    setSelectedNode,
    rightPanelTab,
    setRightPanelTab,
    runNode,
    isRunning,
    nodeRunStates,
    recentNodeIds,
    selectedNodeIds,
    focusNode,
    stats,
    canvasName,
    handleAutoArrange,
    layoutMode,
    setLayoutMode,
    scrollMode,
    handleScrollModeChange,
    handleBatchGenerate,
    uploading,
    handleOpenWorkbench,
    workbenchLoading,
    handleRunDirty,
    dirtyRunning,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
    runnableCount,
    handleDeleteNode,
    handleUpdateNodeData,
    handleCanvasMutation,
    autoPipelineState,
    startAutoPipeline,
    cancelAutoPipeline,
    retryFailed: retryFailedNodes,
    autoPipelineStarting,
  } = useCanvas();

  // 重新生成确认（替代原生 window.confirm，走统一 ConfirmDialog）
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  // 全自动出片进行中时，工具栏展示当前阶段与进度：优先取 WS 管线事件
  // （本会话点击后精确）；页面刷新后事件丢失，从节点状态推导兜底。
  const runningStage = autoPipelineState.stages.find((s) => s.status === "running");
  const derivedStage = [...PRODUCTION_STAGES]
    .reverse()
    .find(({ types }) =>
      nodes.some(
        (n) =>
          types.includes(n.type ?? "") &&
          (((n.data as Record<string, unknown> | undefined)?.status as string) ?? "idle") === "running",
      ),
    );
  let derivedStageText: string | null = null;
  if (derivedStage) {
    const group = nodes.filter((n) => derivedStage.types.includes(n.type ?? ""));
    const done = group.filter(
      (n) => (((n.data as Record<string, unknown> | undefined)?.status as string) ?? "idle") === "done",
    ).length;
    derivedStageText = `${derivedStage.label} ${done}/${group.length}`;
  }
  const autoPipelineStageText =
    autoPipelineState.status === "running"
      ? runningStage
        ? `${PIPELINE_STAGE_LABELS[runningStage.stage] ?? runningStage.stage}` +
          (runningStage.total > 0 ? ` ${runningStage.done}/${runningStage.total}` : "")
        : (derivedStageText ?? "运行中")
      : derivedStageText;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex min-h-0 flex-1">
        <NodePalette />

        <FlowCanvas />

        <div
          className={cn(
            "flex h-full shrink-0 flex-col",
            selectedNode || rightPanelTab === "inspector" ? "w-auto" : "w-[380px]",
          )}
        >
          <div className="flex shrink-0 border-b border-[var(--color-hairline)] bg-[var(--color-surface)] px-1">
            <TabButton
              label="属性"
              icon={<ClipboardList className="size-3.5" />}
              active={rightPanelTab === "inspector"}
              onClick={() => setRightPanelTab("inspector")}
            />
            <TabButton
              label="AI 助手"
              icon={<MessageSquare className="size-3.5" />}
              active={rightPanelTab === "chat"}
              onClick={() => setRightPanelTab("chat")}
            />
          </div>

          {rightPanelTab === "inspector" && (
            <NodeInspector
              node={selectedNode}
              onClose={() => setSelectedNode(null)}
              onRunNode={runNode}
              onDeleteNode={handleDeleteNode}
              onUpdateNodeData={handleUpdateNodeData}
              onGraphAppend={(newNodes: Node[], newEdges: Edge[]) => {
                setNodes((nds: Node[]) => [...nds, ...newNodes]);
                setEdges((eds: Edge[]) => [...eds, ...newEdges]);
              }}
              runState={selectedNode ? nodeRunStates[selectedNode.id] : undefined}
              edges={edges}
              nodes={nodes}
              canvasId={canvasId}
            />
          )}
          {rightPanelTab === "chat" && (
            <ChatPanel
              canvasId={canvasId}
              onCanvasMutation={handleCanvasMutation}
              visible
              defaultTextModelId={defaultTextModelId}
              initialPrompt={initialPrompt}
              initialMode={initialMode}
              nodes={nodes}
              autoPipelineState={autoPipelineState}
              startAutoPipeline={startAutoPipeline}
              cancelAutoPipeline={cancelAutoPipeline}
              retryFailedNodes={retryFailedNodes}
              recentNodeIds={recentNodeIds}
              selectedNodeIds={selectedNodeIds}
              onFocusNode={focusNode}
            />
          )}
        </div>
      </div>

      <BottomToolbar
        stats={stats}
        canvasName={canvasName}
        onAutoArrange={() => void handleAutoArrange()}
        layoutMode={layoutMode}
        onLayoutModeChange={setLayoutMode}
        scrollMode={scrollMode}
        onScrollModeChange={handleScrollModeChange}
        onBatchGenerate={() => void handleBatchGenerate()}
        isRunning={isRunning}
        runnableCount={runnableCount}
        uploading={uploading}
        nodes={nodes}
        runNode={runNode}
        onOpenWorkbench={() => void handleOpenWorkbench()}
        workbenchLoading={workbenchLoading}
        onRunDirty={() => void handleRunDirty()}
        dirtyRunning={dirtyRunning}
        canUndo={canUndo}
        canRedo={canRedo}
        onUndo={handleUndo}
        onRedo={handleRedo}
        onAutoPipeline={() => {
          const script = nodes.find((n) => n.type === "script");
          if (!script) {
            toast.error("请先创建剧本节点");
            return;
          }
          startAutoPipeline(script.id).catch((err: unknown) => {
            const msg = (err as Error).message || "启动失败";
            toast.error(
              msg.includes("already_running") ? "该画布已有出片任务在运行，请等待完成" : msg.slice(0, 80),
            );
          });
        }}
        onRegenerate={() => {
          const script = nodes.find((n) => n.type === "script");
          if (!script) {
            toast.error("请先创建剧本节点");
            return;
          }
          setConfirmRegenerate(true);
        }}
        autoPipelineRunning={autoPipelineState.status === "running" || autoPipelineStarting}
        pipelineStageText={autoPipelineStageText}
      />

      <ConfirmDialog
        open={confirmRegenerate}
        onClose={() => setConfirmRegenerate(false)}
        onConfirm={() => {
          const script = nodes.find((n) => n.type === "script");
          if (script) void startAutoPipeline(script.id, { regenerate: true });
        }}
        title="重新生成整个生产链？"
        description="将删除当前分镜、镜头、图片和视频节点，并从剧本重建整个生产链。此操作不可撤销。"
        confirmLabel="重新生成"
        cancelLabel="取消"
        variant="danger"
      />
    </div>
  );
}

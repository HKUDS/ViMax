"use client";

import type { ReactNode } from "react";
import type { Node } from "@xyflow/react";
import { toast } from "sonner";
import { cn } from "@vimax/ui";
import {
  Undo2,
  Redo2,
  LayoutGrid,
  ArrowRight,
  ArrowDown,
  Wand2,
  ZoomIn,
  Hand,
  Play,
  Film,
  Download,
  Loader2,
  TriangleAlert,
  CheckCircle2,
  RotateCcw,
} from "lucide-react";
import type { LayoutMode } from "../constants/canvas-flow";

export interface CanvasStats {
  byType: Record<string, number>;
  byStatus: Record<string, number>;
  total: number;
}

export interface BottomToolbarProps {
  stats: CanvasStats;
  canvasName: string;
  onAutoArrange: () => void;
  layoutMode: LayoutMode;
  onLayoutModeChange: (mode: LayoutMode) => void;
  scrollMode: "zoom" | "pan";
  onScrollModeChange: (mode: "zoom" | "pan") => void;
  onBatchGenerate: () => void;
  isRunning: boolean;
  runnableCount: number;
  uploading?: boolean;
  nodes?: Node[];
  runNode?: (nodeId: string) => Promise<unknown>;
  onOpenWorkbench?: () => void;
  workbenchLoading?: boolean;
  onRunDirty?: () => void;
  dirtyRunning?: boolean;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onAutoPipeline?: () => void;
  onRegenerate?: () => void;
  autoPipelineRunning?: boolean;
  /** 出片进行中的当前阶段与进度（如「视频 2/8」），驱动按钮文案。 */
  pipelineStageText?: string | null;
}

const ghostBtn =
  "inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-[var(--color-ink-muted)] transition-colors hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)] disabled:cursor-not-allowed disabled:opacity-40";

export function BottomToolbar({
  stats,
  canvasName,
  onAutoArrange,
  layoutMode,
  onLayoutModeChange,
  scrollMode,
  onScrollModeChange,
  onBatchGenerate,
  isRunning,
  runnableCount,
  uploading,
  nodes = [],
  runNode,
  onOpenWorkbench,
  workbenchLoading,
  onRunDirty,
  dirtyRunning,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onAutoPipeline,
  onRegenerate,
  autoPipelineRunning,
  pipelineStageText,
}: BottomToolbarProps) {
  const doneCount = stats.byStatus["done"] ?? 0;
  const runningCount = stats.byStatus["running"] ?? 0;
  const dirtyCount = stats.byStatus["dirty"] ?? 0;

  const layoutModes: { mode: LayoutMode; icon: ReactNode; title: string }[] = [
    { mode: "zone", icon: <LayoutGrid className="size-3" />, title: "分区布局" },
    { mode: "LR", icon: <ArrowRight className="size-3" />, title: "从左到右" },
    { mode: "TB", icon: <ArrowDown className="size-3" />, title: "从上到下" },
  ];

  return (
    <div className="flex h-[40px] shrink-0 items-center gap-2 overflow-x-auto border-t border-[var(--color-hairline)] bg-[var(--color-surface)] px-3 text-[11px]">
      {/* ── Left: identity & status ── */}
      <div className="flex min-w-0 shrink-0 items-center gap-2">
        <span className="max-w-[160px] truncate font-medium text-[var(--color-ink)]">{canvasName}</span>
        <span className="font-mono text-[10px] text-[var(--color-ink-subtle)]">
          {stats.total} 节点
        </span>

      {doneCount > 0 && (
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-success)]">
          <CheckCircle2 className="size-3" />
          {doneCount}
        </span>
      )}
      {runningCount > 0 && (
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-node-running)]">
          <Loader2 className="size-3 animate-spin" />
          {runningCount}
        </span>
      )}

      {dirtyCount > 0 &&
        (onRunDirty ? (
          <button
            type="button"
            onClick={onRunDirty}
            disabled={dirtyRunning}
            title="重跑所有已过期（脏）节点"
            className="inline-flex items-center gap-1 rounded-md border border-[var(--color-warning)] px-2 py-0.5 text-[10px] text-[var(--color-warning)] transition-colors hover:bg-[var(--color-warning-subtle)] disabled:cursor-wait"
          >
            {dirtyRunning ? (
              <>
                <Loader2 className="size-3 animate-spin" />
                重跑中
              </>
            ) : (
              <>
                <TriangleAlert className="size-3" />
                重跑 {dirtyCount}
              </>
            )}
          </button>
        ) : (
          <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-warning)]">
            <TriangleAlert className="size-3" />
            {dirtyCount}
          </span>
        ))}

      {uploading && (
        <span className="inline-flex items-center gap-1 text-[10px] text-[var(--color-ink-subtle)]">
          <Loader2 className="size-3 animate-spin" />
          上传中…
        </span>
      )}
      </div>

      <div className="flex-1" />

      {/* ── Center: editing tools (desktop only) ── */}
      <div className="hidden shrink-0 items-center gap-2 md:flex">
      <button type="button" onClick={onUndo} disabled={!canUndo} title="撤销 (Ctrl+Z)" aria-label="撤销" className={ghostBtn}>
        <Undo2 className="size-3" />
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} title="重做 (Ctrl+Shift+Z)" aria-label="重做" className={ghostBtn}>
        <Redo2 className="size-3" />
      </button>

      <div className="inline-flex overflow-hidden rounded-md border border-[var(--color-hairline)]">
        {layoutModes.map(({ mode, icon, title }, index) => (
          <button
            key={mode}
            type="button"
            onClick={() => onLayoutModeChange(mode)}
            title={title}
            className={cn(
              "inline-flex items-center justify-center px-2 py-1 text-[10px] transition-colors",
              index > 0 && "border-l border-[var(--color-hairline)]",
              layoutMode === mode
                ? "bg-[var(--color-surface-3)] font-semibold text-[var(--color-ink)]"
                : "text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]",
            )}
          >
            {icon}
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={onAutoArrange}
        title={`按${layoutMode === "zone" ? "分区" : `Dagre ${layoutMode === "LR" ? "左→右" : "上→下"}`}自动排列节点`}
        className={ghostBtn}
      >
        <Wand2 className="size-3" />
        排列
      </button>

      <button
        type="button"
        onClick={() => onScrollModeChange(scrollMode === "zoom" ? "pan" : "zoom")}
        title={scrollMode === "zoom" ? "滚轮: 缩放 (点击切换为平移)" : "滚轮: 平移 (点击切换为缩放)"}
        className={ghostBtn}
      >
        {scrollMode === "zoom" ? <ZoomIn className="size-3" /> : <Hand className="size-3" />}
        {scrollMode === "zoom" ? "缩放" : "平移"}
      </button>

      <span className="hidden text-[9px] text-[var(--color-ink-tertiary)] lg:inline">拖拽平移 · Shift框选</span>
      </div>

      <div className="flex-1" />

      {/* ── Right: generation actions ── */}
      <div className="flex shrink-0 items-center gap-2">
      {onAutoPipeline && (
        <button
          type="button"
          onClick={onAutoPipeline}
          disabled={autoPipelineRunning || isRunning}
          title="从剧本节点开始，自动完成分镜→镜头→图片→视频→合成"
          className="inline-flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-accent-on)] transition-opacity hover:bg-[var(--color-accent-hover)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {autoPipelineRunning || pipelineStageText ? (
            <Loader2 className="size-3 animate-spin" />
          ) : (
            <Play className="size-3" />
          )}
          {autoPipelineRunning || pipelineStageText
            ? `出片中${pipelineStageText ? ` · ${pipelineStageText}` : "…"}`
            : "全自动出片"}
        </button>
      )}

      {onRegenerate && (
        <button
          type="button"
          onClick={onRegenerate}
          disabled={autoPipelineRunning || isRunning}
          title="删除已生成的分镜/镜头/图片/视频节点，从剧本重建整个生产链"
          className={cn(ghostBtn, "hidden sm:inline-flex")}
        >
          {autoPipelineRunning ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
          重新生成
        </button>
      )}

      {runnableCount > 0 && (
        <button
          type="button"
          onClick={onBatchGenerate}
          disabled={isRunning}
          title={`逐个运行所有可执行节点 (${runnableCount} 个)`}
          className="inline-flex items-center gap-1 rounded-md border border-[var(--color-accent)] px-2.5 py-1 text-[11px] font-semibold text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent-subtle)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          <Play className="size-3" />
          一键生成 ({runnableCount})
        </button>
      )}

      {onOpenWorkbench && (
        <button
          type="button"
          title="在视频工作台中打开，进行多轨道剪辑"
          onClick={onOpenWorkbench}
          disabled={workbenchLoading}
          className={cn(ghostBtn, "hidden lg:inline-flex")}
        >
          <Film className="size-3" />
          视频剪辑
        </button>
      )}

      <button
        type="button"
        title="导出所有合成节点的视频"
        aria-label="导出所有合成节点的视频"
        onClick={async () => {
          const concatNodes = nodes.filter((n) => n.type === "concat");
          if (concatNodes.length === 0) {
            toast("请先添加合成节点");
            return;
          }
          if (!runNode) return;
          let failed = 0;
          for (const cn of concatNodes) {
            try {
              await runNode(cn.id);
            } catch {
              failed += 1;
            }
          }
          if (failed === 0) {
            toast.success(`已导出 ${concatNodes.length} 个视频`);
          } else if (failed === concatNodes.length) {
            toast.error(`导出失败：${failed} 个合成节点均未成功，请检查节点错误后重试`);
          } else {
            toast.warning(`部分导出成功：${concatNodes.length - failed} 个完成，${failed} 个失败`);
          }
        }}
        className={ghostBtn}
      >
        <Download className="size-3" />
        导出视频
      </button>
      </div>
    </div>
  );
}

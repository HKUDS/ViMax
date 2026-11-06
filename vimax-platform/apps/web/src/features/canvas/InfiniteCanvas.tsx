"use client";

import { CanvasProvider } from "./CanvasProvider";
import { CanvasShell } from "./CanvasShell";
import { CanvasOverlays } from "./components/CanvasOverlays";
import { useCanvas } from "./canvas-context";

export interface InfiniteCanvasProps {
  canvasId: string;
  defaultTextModelId?: string;
  defaultImageModelId?: string;
  defaultVideoModelId?: string;
  initialPrompt?: string;
  initialMode?: string;
  productAssetId?: string;
}

export function InfiniteCanvas(props: InfiniteCanvasProps) {
  return (
    <CanvasProvider {...props}>
      <CanvasContent />
    </CanvasProvider>
  );
}

function CanvasContent() {
  const { isLoading, isError, error, refetch } = useCanvas();

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-[var(--color-text-muted)]">加载画布…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3">
        <p className="text-red-500">加载失败: {String(error)}</p>
        <button
          type="button"
          onClick={() => refetch()}
          className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-1.5 text-sm text-[var(--color-text)] hover:border-[var(--color-accent)]"
        >
          重试
        </button>
      </div>
    );
  }

  return (
    <>
      <CanvasShell />
      <CanvasOverlays />
    </>
  );
}

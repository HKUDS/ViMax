"use client";

import { useParams, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { ErrorBoundary, SkeletonText } from "@vimax/ui";

// Lazy-load the heavy canvas component (React Flow)
const InfiniteCanvas = dynamic(
  () =>
    import("@/features/canvas/InfiniteCanvas").then((mod) => ({
      default: mod.InfiniteCanvas,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full bg-[var(--color-bg)]">
        <div className="text-center space-y-4">
          <div className="w-12 h-12 rounded-full border-2 border-[var(--color-accent)] border-t-transparent animate-spin mx-auto" />
          <SkeletonText lines={2} />
          <p className="text-xs text-[var(--color-text-muted)]">加载画布工作台…</p>
        </div>
      </div>
    ),
  },
);

export default function CanvasPage() {
  const params = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const canvasId = params.id;

  // Read model selections + initial prompt from URL query params (set by home page)
  const textModelId = searchParams.get("textModelId") ?? undefined;
  const imageModelId = searchParams.get("imageModelId") ?? undefined;
  const videoModelId = searchParams.get("videoModelId") ?? undefined;
  const initialPrompt = searchParams.get("prompt") ?? undefined;
  const initialMode = searchParams.get("mode") ?? undefined;
  const productAssetId = searchParams.get("productAssetId") ?? undefined;

  return (
    <ErrorBoundary>
      <div style={{ height: "100vh", width: "100vw", display: "flex", flexDirection: "column" }}>
        {/* Header — RunwayML invisible chrome */}
        <header
          style={{
            height: 44,
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            padding: "0 20px",
            borderBottom: "1px solid var(--color-hairline)",
            backgroundColor: "var(--color-canvas)",
            gap: 16,
          }}
        >
          <a href="/" style={{ fontSize: 12, color: "var(--color-ink-subtle)", textDecoration: "none", fontWeight: 500 }}>← ViMax</a>
          <h1 style={{ fontSize: 12, fontWeight: 600, color: "var(--color-ink)" }}>画布工作台</h1>
          <span style={{ fontSize: 10, color: "var(--color-ink-tertiary)", fontFamily: "var(--font-mono)", letterSpacing: "0.04em", textTransform: "uppercase" }}>{canvasId.slice(0, 8)}</span>
        </header>

        {/* Canvas */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <InfiniteCanvas
            canvasId={canvasId}
            defaultTextModelId={textModelId}
            defaultImageModelId={imageModelId}
            defaultVideoModelId={videoModelId}
            initialPrompt={initialPrompt}
            initialMode={initialMode}
            productAssetId={productAssetId}
          />
        </div>
      </div>
    </ErrorBoundary>
  );
}

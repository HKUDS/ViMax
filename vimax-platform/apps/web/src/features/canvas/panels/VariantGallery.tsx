"use client";

import { toast } from "sonner";
import { Check } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { useAssetSource } from "@/features/assets/useAssetSource";

// ── Variant thumbnail ──────────────────────────────────────────────

function VariantThumb({ assetId, isCurrent }: { assetId: string; isCurrent: boolean }) {
  const { status, url } = useAssetSource(assetId);
  return (
    <div
      style={{
        position: "relative",
        width: 64,
        height: 64,
        borderRadius: 6,
        overflow: "hidden",
        border: `2px solid ${isCurrent ? "var(--color-accent)" : "var(--color-border)"}`,
        backgroundColor: "var(--color-bg)",
      }}
    >
      {status === "loading" ? (
        <div style={{ fontSize: 9, color: "var(--color-text-dim)", padding: 4 }}>…</div>
      ) : url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={url} alt="variant" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      ) : (
        <div style={{ fontSize: 9, color: "var(--color-text-dim)", padding: 4 }}>无预览</div>
      )}
      {isCurrent && (
        <span
          style={{
            position: "absolute",
            top: 2,
            left: 2,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--color-accent-on)",
            backgroundColor: "var(--color-accent)",
            borderRadius: 4,
            width: 14,
            height: 14,
          }}
        >
          <Check size={10} strokeWidth={3} />
        </span>
      )}
    </div>
  );
}

export interface VariantEntry {
  assetId: string;
  jobId: string;
  index: number;
}

interface VariantGalleryProps {
  canvasId: string;
  nodeId: string;
  variants: VariantEntry[];
  currentOutputAssetId?: string | null;
  onUpdate?: () => void;
}

/**
 * Generate N variants of an image node and pick the best one. Each variant
 * thumbnail loads its presigned URL independently; "选用" promotes it to the
 * node's output (which also re-runs stale downstream nodes server-side).
 */
export function VariantGallery({
  canvasId,
  nodeId,
  variants,
  currentOutputAssetId,
}: VariantGalleryProps) {
  const runVariants = trpc.canvas.runVariants.useMutation();
  const pickVariant = trpc.canvas.pickVariant.useMutation();

  const handleGenerate = async () => {
    try {
      const res = await runVariants.mutateAsync({
        canvas_id: canvasId,
        node_id: nodeId,
        count: 4,
      });
      toast.success(`已生成 ${res.jobIds.length} 个变体，完成后将显示在下方`);
    } catch {
      toast.error("生成变体失败");
    }
  };

  const handlePick = async (assetId: string) => {
    try {
      await pickVariant.mutateAsync({
        canvas_id: canvasId,
        node_id: nodeId,
        asset_id: assetId,
      });
      toast.success("已选用该变体");
    } catch {
      toast.error("选用失败");
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <button
        onClick={handleGenerate}
        disabled={runVariants.isPending}
        style={{
          padding: "5px 10px",
          borderRadius: 6,
          border: "1px solid var(--color-accent)",
          backgroundColor: "transparent",
          color: "var(--color-accent)",
          fontSize: 11,
          cursor: runVariants.isPending ? "wait" : "pointer",
        }}
      >
        生成 4 个变体
      </button>
      {runVariants.isPending && (
        <p style={{ fontSize: 10, color: "var(--color-node-running)", margin: 0 }}>生成中…</p>
      )}

      {variants.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {variants.map((v) => (
            <div key={v.jobId} style={{ display: "flex", flexDirection: "column", gap: 3, alignItems: "center" }}>
              <VariantThumb assetId={v.assetId} isCurrent={v.assetId === currentOutputAssetId} />
              <button
                onClick={() => handlePick(v.assetId)}
                disabled={pickVariant.isPending || v.assetId === currentOutputAssetId}
                style={{
                  fontSize: 9,
                  padding: "1px 6px",
                  borderRadius: 4,
                  border: "1px solid var(--color-border)",
                  backgroundColor: "transparent",
                  color: "var(--color-text-muted)",
                  cursor: v.assetId === currentOutputAssetId ? "default" : "pointer",
                }}
              >
                选用
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

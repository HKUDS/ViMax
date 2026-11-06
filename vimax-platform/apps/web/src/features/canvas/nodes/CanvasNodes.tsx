"use client";

import { useEffect, useState } from "react";
import { Handle, Position, type NodeProps } from "@xyflow/react";
import type { CanvasNodeType, VariantEntry } from "@vimax/contracts";
import { Download, Check, CloudUpload, ImagePlus, Loader2, Play, Plus, UserRound, TriangleAlert, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc/client";
import { downloadLocalAsset, getLocalAssetBlob } from "@/lib/local-assets";
import { AssetPreview } from "../components/AssetPreview";
import { InlineEditText } from "./InlineEditText";
import { useCanvas } from "../canvas-context";
import { RUNNABLE_TYPES } from "../constants/canvas-flow";
import {
  NODE_TYPE_VISUALS,
  STATUS_COLOR,
  STATUS_LABEL,
  nodeTypeColor,
} from "../constants/node-visuals";

// ── Canvas Node Shell ───────────────────────────────────────────────
// One card anatomy for every node type:
// - Header: tinted icon chip (type color) + type label + status dot
// - Body: free content on a hairline divider
// - State: accent outline for selection, blue ring for running,
//   dashed amber border for dirty, red border for failed. Type colors
//   never paint the card border, so selection always reads as selection.

export interface CanvasNodeShellProps {
  /** Own node id — enables the inline retry button on failure. */
  nodeId?: string;
  type: CanvasNodeType;
  status?: string;
  selected?: boolean;
  /** Failure message rendered inline on the card (from node data.errorMsg). */
  errorMsg?: string;
  /** Hover actions rendered in a floating bubble above the node. */
  actions?: React.ReactNode;
  children: React.ReactNode;
}

export function CanvasNodeShell({
  nodeId,
  type,
  status = "idle",
  selected = false,
  errorMsg,
  actions,
  children,
}: CanvasNodeShellProps) {
  const { runNode } = useCanvas();
  const [hovered, setHovered] = useState(false);
  const visual = NODE_TYPE_VISUALS[type];
  const Icon = visual.icon;
  const typeColor = nodeTypeColor(type);

  const isRunning = status === "running";
  const isDirty = status === "dirty";
  const isFailed = status === "failed";

  const borderColor = isFailed
    ? "var(--color-node-error)"
    : selected
      ? "var(--color-accent)"
      : isRunning
        ? "rgba(95, 159, 216, 0.55)"
        : "var(--color-hairline-strong)";

  const shadow = selected
    ? "0 4px 16px rgba(0,0,0,0.4), 0 0 0 3px var(--color-accent-muted)"
    : "0 2px 10px rgba(0,0,0,0.32)";

  const anim = isRunning
    ? "nodePulse 1.6s ease-in-out infinite"
    : isDirty
      ? "nodeDirtyPulse 2s ease-in-out infinite"
      : undefined;

  const statusColor = STATUS_COLOR[status] ?? STATUS_COLOR.idle;
  const statusLabel = STATUS_LABEL[status];

  return (
    <div
      className="node-shell"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        minWidth: 220,
        maxWidth: 320,
        borderRadius: 12,
        border: `1px ${isDirty ? "dashed" : "solid"} ${borderColor}`,
        backgroundColor: "var(--color-surface-1)",
        boxShadow: shadow,
        transition: "border-color 0.2s, box-shadow 0.2s",
        animation: anim,
        position: "relative",
        overflow: "visible",
      }}
    >
      {/* Left target handle — LibTV-style grip */}
      <Handle
        type="target"
        position={Position.Left}
        style={{
          width: 16,
          height: 16,
          left: -9,
          background: "var(--color-surface-1)",
          border: `1.5px solid ${isFailed ? "var(--color-node-error)" : typeColor}`,
          color: isFailed ? "var(--color-node-error)" : typeColor,
        }}
      >
        <Plus size={9} strokeWidth={3} style={{ pointerEvents: "none" }} />
      </Handle>

      {/* Hover quick actions */}
      {hovered && actions && (
        <div
          style={{
            position: "absolute",
            top: -32,
            right: 6,
            display: "flex",
            gap: 4,
            zIndex: 30,
          }}
        >
          {actions}
        </div>
      )}

      {/* Header: type chip + label + status */}
      <div
        className="dragHandle"
        style={{
          cursor: "grab",
          userSelect: "none",
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
        }}
      >
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 24,
            height: 24,
            borderRadius: 7,
            backgroundColor: `color-mix(in srgb, ${typeColor} 16%, transparent)`,
            color: typeColor,
            flexShrink: 0,
          }}
        >
          <Icon size={13} />
        </span>
        <span
          style={{
            fontSize: 12.5,
            fontWeight: 600,
            color: "var(--color-ink)",
            lineHeight: 1,
          }}
        >
          {visual.label}
        </span>

        {isRunning && (
          <span
            style={{
              position: "absolute",
              top: 0,
              left: 14,
              right: 14,
              height: 2,
              borderRadius: 1,
              overflow: "hidden",
            }}
          >
            <span
              style={{
                display: "block",
                height: "100%",
                width: "100%",
                background:
                  "linear-gradient(90deg, transparent, var(--color-node-running), transparent)",
                animation: "beamSlide 1.4s ease-in-out infinite",
              }}
            />
          </span>
        )}

        <span style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }}>
          {statusLabel && (
            <span style={{ fontSize: 10, color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
          )}
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: "50%",
              backgroundColor: statusColor,
            }}
            title={status}
          />
        </span>
      </div>

      {/* Divider */}
      <div
        style={{
          height: 1,
          backgroundColor: isDirty
            ? "color-mix(in srgb, var(--color-node-dirty) 25%, transparent)"
            : "var(--color-hairline)",
          margin: "0 12px",
        }}
      />

      {/* Body */}
      <div style={{ padding: "9px 12px 11px", fontSize: 12, lineHeight: 1.55 }}>
        {children}
      </div>

      {/* Inline failure feedback — message + retry, right on the card */}
      {isFailed && (
        <div
          className="nodrag"
          style={{
            margin: "0 12px 10px",
            padding: "6px 8px",
            borderRadius: 8,
            backgroundColor: "color-mix(in srgb, var(--color-node-error) 10%, transparent)",
            border: "1px solid color-mix(in srgb, var(--color-node-error) 30%, transparent)",
            display: "flex",
            alignItems: "flex-start",
            gap: 6,
          }}
        >
          <TriangleAlert size={11} style={{ color: "var(--color-node-error)", flexShrink: 0, marginTop: 2 }} />
          <span
            style={{
              flex: 1,
              minWidth: 0,
              fontSize: 10.5,
              color: "var(--color-node-error)",
              lineHeight: 1.5,
              wordBreak: "break-all",
              display: "-webkit-box",
              WebkitLineClamp: 3,
              WebkitBoxOrient: "vertical",
              overflow: "hidden",
            }}
          >
            {errorMsg ?? "节点执行失败"}
          </span>
          {nodeId && (
            <button
              type="button"
              title="重试此节点"
              aria-label="重试此节点"
              onClick={(e) => {
                e.stopPropagation();
                void runNode(nodeId);
              }}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 3,
                flexShrink: 0,
                fontSize: 10,
                fontWeight: 600,
                padding: "2px 7px",
                borderRadius: 6,
                border: "1px solid color-mix(in srgb, var(--color-node-error) 45%, transparent)",
                backgroundColor: "transparent",
                color: "var(--color-node-error)",
                cursor: "pointer",
              }}
            >
              <RotateCcw size={9} />
              重试
            </button>
          )}
        </div>
      )}

      {/* Right source handle — LibTV-style grip */}
      <Handle
        type="source"
        position={Position.Right}
        style={{
          width: 16,
          height: 16,
          right: -9,
          background: "var(--color-surface-1)",
          border: `1.5px solid ${isFailed ? "var(--color-node-error)" : typeColor}`,
          color: isFailed ? "var(--color-node-error)" : typeColor,
        }}
      >
        <Plus size={9} strokeWidth={3} style={{ pointerEvents: "none" }} />
      </Handle>
    </div>
  );
}

// ── Individual Node Components ─────────────────────────────────────

const ACTION_BUTTON_STYLE: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: "50%",
  border: "1px solid var(--color-hairline-strong)",
  backgroundColor: "var(--color-surface-2)",
  color: "var(--color-ink)",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  cursor: "pointer",
  boxShadow: "0 2px 8px rgba(0,0,0,0.35)",
};

/** Hover bubble actions: run, download output, save to cloud, spawn a downstream i2i image node. */
export function NodeQuickActions({
  nodeId,
  nodeType,
  outputAssetId,
}: {
  nodeId: string;
  nodeType: string;
  outputAssetId?: string;
}) {
  const { runNode, addDownstreamImageNode, handleUpdateNodeData } = useCanvas();
  const [downloadId, setDownloadId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const { data: downloadUrl } = trpc.canvas.getAssetUrl.useQuery(
    { asset_id: downloadId! },
    { enabled: downloadId !== null, staleTime: 60_000 },
  );
  const requestUpload = trpc.asset.requestUpload.useMutation();
  const confirmUpload = trpc.asset.confirmUpload.useMutation();

  useEffect(() => {
    if (downloadUrl?.url) {
      window.open(downloadUrl.url, "_blank");
      setDownloadId(null);
    }
  }, [downloadUrl]);

  // 下载优先走本地金库（无网络开销）；本地无副本再回退远端签名 URL
  const handleDownload = async (assetId: string) => {
    const ext = nodeType === "video" ? "mp4" : nodeType === "audio" ? "m4a" : "png";
    const saved = await downloadLocalAsset(assetId, `vimax-${nodeType}-${assetId.slice(0, 8)}.${ext}`);
    if (!saved) setDownloadId(assetId);
  };

  // 手动上云：把本地副本经既有上传通道存为受保护资产（source=upload，
  // 永不被自动清除），并把节点重绑到新资产
  const handleUploadToCloud = async (assetId: string) => {
    const blob = await getLocalAssetBlob(assetId);
    if (!blob) {
      setDownloadId(assetId); // 本机无副本：退化为打开远端（如有）
      return;
    }
    setUploading(true);
    try {
      const mime = blob.type || "application/octet-stream";
      const req = await requestUpload.mutateAsync({
        mime_type: mime as
          | "image/png"
          | "image/jpeg"
          | "image/webp"
          | "video/mp4"
          | "video/webm"
          | "audio/m4a",
        size_bytes: blob.size,
      });
      await fetch(req.upload_url, { method: "PUT", body: blob, headers: { "Content-Type": mime } });
      const digest = await crypto.subtle.digest("SHA-256", await blob.arrayBuffer());
      const sha256 = Array.from(new Uint8Array(digest))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
      await confirmUpload.mutateAsync({ asset_id: req.asset_id, sha256, width: 0, height: 0 });
      handleUpdateNodeData(nodeId, "outputAssetId", req.asset_id);
    } finally {
      setUploading(false);
    }
  };

  const canSpawnImage = ["script", "character", "storyboard_cell", "shot", "image", "video"].includes(nodeType);

  return (
    <>
      {RUNNABLE_TYPES.has(nodeType) && (
        <button
          type="button"
          title="运行节点"
          aria-label="运行节点"
          style={ACTION_BUTTON_STYLE}
          onClick={(e) => {
            e.stopPropagation();
            void runNode(nodeId);
          }}
        >
          <Play size={12} />
        </button>
      )}
      {outputAssetId && (
        <button
          type="button"
          title="下载到本机"
          aria-label="下载到本机"
          style={ACTION_BUTTON_STYLE}
          onClick={(e) => {
            e.stopPropagation();
            void handleDownload(outputAssetId);
          }}
        >
          <Download size={12} />
        </button>
      )}
      {outputAssetId && (
        <button
          type="button"
          title="存到云端（手动上传，长期保留）"
          aria-label="存到云端"
          style={ACTION_BUTTON_STYLE}
          disabled={uploading}
          onClick={(e) => {
            e.stopPropagation();
            void handleUploadToCloud(outputAssetId);
          }}
        >
          {uploading ? <Loader2 size={12} className="animate-spin" /> : <CloudUpload size={12} />}
        </button>
      )}
      {canSpawnImage && (
        <button
          type="button"
          title="插入下游图片节点（基于本节点输出 i2i 精修）"
          aria-label="插入下游图片节点"
          style={ACTION_BUTTON_STYLE}
          onClick={(e) => {
            e.stopPropagation();
            addDownstreamImageNode(nodeId);
          }}
        >
          <ImagePlus size={12} />
        </button>
      )}
    </>
  );
}

export function ScriptNode({ id, data, selected }: NodeProps) {
  const content = (data.content as string) ?? "";
  return (
    <CanvasNodeShell type="script" status={data.status as string} selected={selected}>
      <InlineEditText
        nodeId={id}
        field="content"
        value={content}
        placeholder="双击编辑剧本…"
        clampLines={5}
        rows={6}
      />
    </CanvasNodeShell>
  );
}

export function CharacterNode({ data, selected }: NodeProps) {
  const name = (data.name as string) ?? "新角色";
  const desc = (data.description as string) ?? "";
  return (
    <CanvasNodeShell type="character" status={data.status as string} selected={selected}>
      <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
        <span
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: 22,
            height: 22,
            borderRadius: "50%",
            backgroundColor: "color-mix(in srgb, var(--color-node-character) 14%, transparent)",
            color: "var(--color-node-character)",
            flexShrink: 0,
          }}
        >
          <UserRound size={12} />
        </span>
        <span style={{ fontWeight: 600, color: "var(--color-ink)" }}>{name}</span>
      </div>
      {desc && (
        <p style={{ color: "var(--color-ink-muted)", fontSize: 11, margin: "5px 0 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {desc}
        </p>
      )}
    </CanvasNodeShell>
  );
}

export function StoryboardCellNode({ id, data, selected }: NodeProps) {
  const brief = (data.shotBrief as string) ?? "";
  const audio = (data.audioDesc as string) ?? "";
  return (
    <CanvasNodeShell nodeId={id} type="storyboard_cell" status={data.status as string} selected={selected} errorMsg={(data.errorMsg as string) ?? undefined}>
      <div style={{ marginBottom: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            padding: "1px 7px",
            borderRadius: 999,
            backgroundColor: "color-mix(in srgb, var(--color-node-storyboard) 14%, transparent)",
            color: "var(--color-node-storyboard)",
          }}
        >
          机位 #{(data.cameraIdx as number) ?? 0}
        </span>
      </div>
      {brief && (
        <p style={{ color: "var(--color-ink-muted)", fontSize: 11, margin: 0, display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {brief}
        </p>
      )}
      {audio && (
        <p style={{ color: "var(--color-ink-tertiary)", fontSize: 10, margin: "4px 0 0", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
          {audio}
        </p>
      )}
    </CanvasNodeShell>
  );
}

export function ShotNode({ id, data, selected }: NodeProps) {
  const ffDesc = (data.ffDesc as string) ?? "";
  const motion = (data.motionDesc as string) ?? "";
  return (
    <CanvasNodeShell
      type="shot"
      status={data.status as string}
      selected={selected}
      actions={
        <NodeQuickActions
          nodeId={id}
          nodeType="shot"
          outputAssetId={data.outputAssetId as string | undefined}
        />
      }
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {ffDesc && (
          <div style={{ fontSize: 11 }}>
            <span style={{ color: "var(--color-ink-subtle)", fontWeight: 600 }}>首帧</span>{" "}
            <span style={{ color: "var(--color-ink-muted)" }}>{ffDesc.slice(0, 80)}{ffDesc.length > 80 ? "…" : ""}</span>
          </div>
        )}
        {motion && (
          <div style={{ fontSize: 11 }}>
            <span style={{ color: "var(--color-ink-subtle)", fontWeight: 600 }}>运动</span>{" "}
            <span style={{ color: "var(--color-ink-muted)" }}>{motion}</span>
          </div>
        )}
        <InlineEditText
          nodeId={id}
          field="ffDesc"
          value={ffDesc}
          placeholder="双击编辑首帧描述…"
          clampLines={2}
          rows={3}
        />
      </div>
    </CanvasNodeShell>
  );
}

export function ImageNode({ id, data, selected }: NodeProps) {
  const prompt = (data.prompt as string) ?? "";
  const size = (data.size as string) ?? "1024x1024";
  const outputAssetId = data.outputAssetId as string | undefined;
  const status = data.status as string;
  const variants = (data.variants as VariantEntry[] | undefined) ?? [];
  const { canvasId, handleUpdateNodeData } = useCanvas();
  const pickVariant = trpc.canvas.pickVariant.useMutation();

  const handlePickVariant = (variant: VariantEntry) => {
    if (variant.assetId === outputAssetId) return;
    pickVariant
      .mutateAsync({ canvas_id: canvasId, node_id: id, asset_id: variant.assetId })
      .then(() => handleUpdateNodeData(id, "outputAssetId", variant.assetId))
      .catch(() => {});
  };

  return (
    <CanvasNodeShell
      type="image"
      status={status}
      selected={selected}
      actions={
        <NodeQuickActions nodeId={id} nodeType="image" outputAssetId={outputAssetId} />
      }
    >
      {outputAssetId && status === "done" && (
        <div style={{ marginBottom: 8 }}>
          <AssetPreview assetId={outputAssetId} kind="image" />
        </div>
      )}
      {variants.length > 1 && (
        <div
          className="nodrag nowheel"
          style={{ display: "flex", gap: 4, overflowX: "auto", marginBottom: 8 }}
        >
          {variants.slice(0, 8).map((variant) => (
            <button
              key={variant.assetId}
              type="button"
              title={variant.assetId === outputAssetId ? "当前选用" : "选用此变体"}
              onClick={(e) => {
                e.stopPropagation();
                handlePickVariant(variant);
              }}
              style={{
                padding: 0,
                border: variant.assetId === outputAssetId ? "2px solid var(--color-accent)" : "2px solid transparent",
                borderRadius: 6,
                overflow: "hidden",
                cursor: "pointer",
                flexShrink: 0,
                background: "none",
              }}
            >
              <AssetPreview assetId={variant.assetId} kind="image" height={56} />
            </button>
          ))}
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            padding: "1px 7px",
            borderRadius: 999,
            backgroundColor: "var(--color-surface-3)",
            color: "var(--color-ink-subtle)",
          }}
        >
          {size}
        </span>
      </div>
      <InlineEditText
        nodeId={id}
        field="prompt"
        value={prompt}
        placeholder="双击编辑提示词…"
        clampLines={2}
        rows={3}
      />
    </CanvasNodeShell>
  );
}

export function VideoNode({ id, data, selected }: NodeProps) {
  const motion = (data.motionPreset as string) ?? "";
  const duration = (data.durationSec as number) ?? 4;
  const outputAssetId = data.outputAssetId as string | undefined;
  const status = data.status as string;

  return (
    <CanvasNodeShell
      nodeId={id}
      type="video"
      status={status}
      selected={selected}
      errorMsg={(data.errorMsg as string) ?? undefined}
      actions={
        <NodeQuickActions nodeId={id} nodeType="video" outputAssetId={outputAssetId} />
      }
    >
      {outputAssetId && status === "done" && (
        <div style={{ marginBottom: 8 }}>
          <AssetPreview assetId={outputAssetId} kind="video" />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
        <span
          style={{
            fontSize: 10,
            fontFamily: "var(--font-mono)",
            padding: "1px 7px",
            borderRadius: 999,
            backgroundColor: "var(--color-surface-3)",
            color: "var(--color-ink-subtle)",
          }}
        >
          {duration}s
        </span>
        {motion && (
          <span style={{ fontSize: 11, color: "var(--color-ink-muted)" }}>
            {motion}
          </span>
        )}
      </div>
    </CanvasNodeShell>
  );
}

export function AudioNode({ id, data, selected }: NodeProps) {
  const prompt = (data.prompt as string) ?? "";
  const outputAssetId = data.outputAssetId as string | undefined;
  const status = data.status as string;
  const { data: audioUrl } = trpc.canvas.getAssetUrl.useQuery(
    { asset_id: outputAssetId! },
    { enabled: !!outputAssetId && status === "done", staleTime: 60_000 },
  );

  return (
    <CanvasNodeShell
      type="audio"
      status={status}
      selected={selected}
      actions={<NodeQuickActions nodeId={id} nodeType="audio" outputAssetId={outputAssetId} />}
    >
      {outputAssetId && status === "done" && audioUrl?.url && (
        <audio controls src={audioUrl.url} className="mb-2 w-full" style={{ height: 32 }} />
      )}
      <InlineEditText
        nodeId={id}
        field="prompt"
        value={prompt}
        placeholder="双击描述音效或配乐…"
        clampLines={3}
        rows={3}
      />
    </CanvasNodeShell>
  );
}

export function ConcatNode({ id, data, selected }: NodeProps) {
  const transition = (data.transition as string) ?? "dissolve";
  const outputAssetId = data.outputAssetId as string | undefined;
  const status = data.status as string;

  return (
    <CanvasNodeShell
      nodeId={id}
      type="concat"
      status={status}
      selected={selected}
      errorMsg={(data.errorMsg as string) ?? undefined}
      actions={
        <NodeQuickActions nodeId={id} nodeType="concat" outputAssetId={outputAssetId} />
      }
    >
      {outputAssetId && status === "done" && (
        <div style={{ marginBottom: 8 }}>
          <AssetPreview assetId={outputAssetId} kind="video" />
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{ fontSize: 11, color: "var(--color-ink-muted)" }}>
          转场: {transition}
        </span>
        {status === "done" && outputAssetId && (
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 3,
              fontSize: 10,
              padding: "1px 7px",
              borderRadius: 999,
              backgroundColor: "var(--color-success-subtle)",
              color: "var(--color-success)",
              fontWeight: 600,
            }}
          >
            <Check size={10} />
            可下载
          </span>
        )}
      </div>
    </CanvasNodeShell>
  );
}

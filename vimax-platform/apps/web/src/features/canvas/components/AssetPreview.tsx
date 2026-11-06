"use client";

import { Cloud, CloudOff, HardDrive } from "lucide-react";
import { useAssetSource } from "@/features/assets/useAssetSource";

interface AssetPreviewProps {
  assetId: string;
  kind?: "image" | "video";
  className?: string;
  /** Rendered height in px (default 120). */
  height?: number;
  /** Show the local/cloud storage chip (default true). */
  showStorageBadge?: boolean;
}

/** 存储状态徽标：本机（绿）/ 云端（默认紫）/ 已过期仅存原设备 */
function StorageBadge({ status }: { status: "local" | "cloud" | "missing" }) {
  const conf = {
    local: { icon: HardDrive, label: "本机", color: "var(--color-success)" },
    cloud: { icon: Cloud, label: "云端", color: "var(--color-ink-subtle)" },
    missing: { icon: CloudOff, label: "仅存原设备", color: "var(--color-warning)" },
  }[status];
  const Icon = conf.icon;
  return (
    <span
      style={{
        position: "absolute",
        top: 6,
        right: 6,
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        padding: "2px 6px",
        borderRadius: 999,
        fontSize: 9,
        lineHeight: 1.4,
        color: conf.color,
        backgroundColor: "rgba(10, 12, 18, 0.72)",
        backdropFilter: "blur(4px)",
        pointerEvents: "none",
      }}
    >
      <Icon size={10} />
      {conf.label}
    </span>
  );
}

export function AssetPreview({
  assetId,
  kind = "video",
  className,
  height = 120,
  showStorageBadge = true,
}: AssetPreviewProps) {
  const { status, url } = useAssetSource(assetId);

  if (status === "loading") {
    return (
      <div
        className={className}
        style={{
          height,
          borderRadius: 6,
          backgroundColor: "var(--color-bg)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          color: "var(--color-text-muted)",
        }}
      >
        加载预览…
      </div>
    );
  }

  if (status === "missing" || !url) {
    return (
      <div
        className={className}
        style={{
          height: 80,
          borderRadius: 6,
          backgroundColor: "var(--color-bg)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 4,
          fontSize: 10,
          color: "var(--color-text-muted)",
        }}
      >
        <CloudOff size={14} style={{ opacity: 0.6 }} />
        本机无副本，云端已清除
      </div>
    );
  }

  const media =
    kind === "image" ? (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={url}
        alt="preview"
        loading="lazy"
        className={className}
        style={{
          width: "100%",
          height,
          objectFit: "cover",
          borderRadius: 6,
          backgroundColor: "var(--color-bg)",
        }}
      />
    ) : (
      <video
        src={url}
        controls
        preload="metadata"
        className={className}
        style={{
          width: "100%",
          height,
          borderRadius: 6,
          backgroundColor: "#000",
          objectFit: "contain",
        }}
      />
    );

  if (!showStorageBadge) return media;
  return (
    <div style={{ position: "relative" }}>
      {media}
      <StorageBadge status={status} />
    </div>
  );
}

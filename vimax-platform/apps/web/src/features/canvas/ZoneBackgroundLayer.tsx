"use client";

// ── Zone Background Layer (pipeline backdrop) ───────────────────────
//
// Renders the seven labelled zone backdrops (剧本 / 角色 / 分镜 / 镜头 /
// 首帧 / 视频 / 合成) behind the canvas nodes. The overlay tracks the
// ReactFlow viewport via useViewport() so the backdrops pan/zoom with the
// canvas. pointer-events are disabled so they never intercept node dragging,
// selection, or edge drawing.
//
// Zones stay quiet by design: a 1px dashed frame and a small tinted header
// per stage. The type color only tints these small areas; the backdrop body
// stays transparent.

import { useViewport } from "@xyflow/react";
import type { CanvasNodeType } from "@vimax/contracts";
import { NODE_TYPE_VISUALS } from "./constants/node-visuals";
import { ZONE_BOX, ZONE_LAYOUT } from "./utils/dagre-layout";

const ZONE_ORDER: CanvasNodeType[] = [
  "script",
  "character",
  "storyboard_cell",
  "shot",
  "image",
  "video",
  "concat",
];

export function ZoneBackgroundLayer() {
  const { x, y, zoom } = useViewport();
  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        width: 0,
        height: 0,
        transform: `translate(${x}px, ${y}px) scale(${zoom})`,
        transformOrigin: "0 0",
        pointerEvents: "none",
        zIndex: 0,
      }}
    >
      {ZONE_ORDER.map((type) => {
        const zone = ZONE_LAYOUT[type];
        const visual = NODE_TYPE_VISUALS[type];
        const Icon = visual.icon;
        const color = `var(${visual.colorVar})`;
        return (
          <div
            key={type}
            style={{
              position: "absolute",
              left: zone.x,
              top: zone.y,
              width: ZONE_BOX.width,
              height: ZONE_BOX.height,
              border: `1px dashed color-mix(in srgb, ${color} 22%, transparent)`,
              borderRadius: 16,
            }}
          >
            <div
              style={{
                padding: "7px 12px",
                color,
                fontWeight: 600,
                fontSize: 12,
                letterSpacing: "0.02em",
                display: "flex",
                alignItems: "center",
                gap: 6,
                borderBottom: `1px solid color-mix(in srgb, ${color} 10%, transparent)`,
                width: "fit-content",
                maxWidth: "100%",
                borderRadius: "16px 16px 0 0",
                // 同色系底衬：标题与节点/连线重叠时仍可辨认
                backgroundColor: `color-mix(in srgb, ${color} 10%, var(--color-canvas))`,
                backdropFilter: "blur(4px)",
              }}
            >
              <Icon size={13} />
              <span style={{ whiteSpace: "nowrap" }}>{visual.label}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

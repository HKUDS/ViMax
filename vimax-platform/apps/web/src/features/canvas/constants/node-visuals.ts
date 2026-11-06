// ── Node Type Visual Map (single source for canvas type coding) ─────
//
// One label + one icon + one color token per canvas node type. Every
// surface that colors a node type (canvas node shells, palette, zone
// backdrops, minimap, edge strokes) reads from here so the categorical
// ramp stays consistent.
//
// Type colors are identity coding for small areas only (icon chips,
// zone headers, edges). State is communicated separately through
// status colors, never by recoloring the whole node.

import type { CanvasNodeType } from "@vimax/contracts";
import type { LucideIcon } from "lucide-react";
import {
  AudioLines,
  Clapperboard,
  Film,
  Image as ImageIcon,
  Link2,
  PlaySquare,
  ScrollText,
  UserRound,
} from "lucide-react";

export interface NodeTypeVisual {
  label: string;
  icon: LucideIcon;
  /** CSS custom property name (no `var()` wrapper) holding the type color. */
  colorVar: string;
}

export const NODE_TYPE_VISUALS: Record<CanvasNodeType, NodeTypeVisual> = {
  script: { label: "剧本", icon: ScrollText, colorVar: "--color-node-script" },
  character: { label: "角色", icon: UserRound, colorVar: "--color-node-character" },
  storyboard_cell: { label: "分镜格", icon: Clapperboard, colorVar: "--color-node-storyboard" },
  shot: { label: "镜头", icon: Film, colorVar: "--color-node-shot" },
  image: { label: "首帧", icon: ImageIcon, colorVar: "--color-node-image" },
  video: { label: "视频", icon: PlaySquare, colorVar: "--color-node-video" },
  audio: { label: "音频", icon: AudioLines, colorVar: "--color-node-audio" },
  concat: { label: "合成", icon: Link2, colorVar: "--color-node-concat" },
};

/** Returns `var(--color-node-*)` for a node type. */
export function nodeTypeColor(type: CanvasNodeType): string {
  return `var(${NODE_TYPE_VISUALS[type].colorVar})`;
}

/** Concrete hex mirror of the dark-theme ramp, for contexts that need a
 * real color string (minimap canvas fill, SVG stroke on stored edges). */
export const NODE_TYPE_HEX: Record<CanvasNodeType, string> = {
  script: "#b98e57",
  character: "#c47f92",
  storyboard_cell: "#58a8b5",
  shot: "#5f8fd0",
  image: "#9182cc",
  video: "#58ab84",
  concat: "#7d95ad",
  audio: "#a3a86b",
};

/** Status dot/pill colors, keyed by node run status. */
export const STATUS_COLOR: Record<string, string> = {
  idle: "var(--color-node-idle)",
  queued: "var(--color-node-queued)",
  running: "var(--color-node-running)",
  done: "var(--color-node-done)",
  dirty: "var(--color-node-dirty)",
  failed: "var(--color-node-error)",
};

/** Active (non-idle) status labels shown in the node header. */
export const STATUS_LABEL: Record<string, string> = {
  running: "生成中",
  done: "已完成",
  dirty: "已过期",
  failed: "失败",
  queued: "排队中",
};

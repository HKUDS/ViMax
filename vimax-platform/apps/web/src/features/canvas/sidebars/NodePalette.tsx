"use client";

import type { DragEvent } from "react";
import type { LucideIcon } from "lucide-react";
import type { CanvasNodeType } from "@vimax/contracts";
import { cn } from "@vimax/ui";
import {
  AudioLines,
  ScrollText,
  Clapperboard,
  User,
  Image,
  Video,
  PlaySquare,
  Link2,
  PenLine,
  Palette,
  Film,
  Wrench,
  UserRound,
  Mountain,
  SquareUser,
  Package,
  Shapes,
} from "lucide-react";
import { NODE_TYPE_VISUALS } from "../constants/node-visuals";

const PALETTE_GROUPS: {
  label: string;
  icon: LucideIcon;
  items: { type: CanvasNodeType; label: string; icon: LucideIcon; kind?: string }[];
}[] = [
  {
    label: "叙事",
    icon: PenLine,
    items: [
      { type: "script", label: "剧本", icon: ScrollText },
      { type: "storyboard_cell", label: "分镜格", icon: Clapperboard },
    ],
  },
  {
    label: "资产",
    icon: Palette,
    items: [
      { type: "character", label: "角色", icon: User },
      { type: "image", label: "首帧/末帧", icon: Image },
    ],
  },
  {
    label: "素材",
    icon: Shapes,
    items: [
      { type: "image", label: "人物形象", icon: UserRound, kind: "portrait" },
      { type: "image", label: "场景概念", icon: Mountain, kind: "environment" },
      { type: "image", label: "角色设定", icon: SquareUser, kind: "character_design" },
      { type: "image", label: "道具素材", icon: Package, kind: "prop" },
    ],
  },
  {
    label: "制作",
    icon: Film,
    items: [
      { type: "shot", label: "镜头", icon: Video },
      { type: "video", label: "视频片段", icon: PlaySquare },
    ],
  },
  {
    label: "音频",
    icon: AudioLines,
    items: [{ type: "audio", label: "音效/配乐", icon: AudioLines }],
  },
  {
    label: "后期",
    icon: Wrench,
    items: [{ type: "concat", label: "合成导出", icon: Link2 }],
  },
];

export function NodePalette() {
  const onDragStart = (event: DragEvent, nodeType: CanvasNodeType, kind?: string) => {
    event.dataTransfer.setData("application/reactflow-type", nodeType);
    if (kind) event.dataTransfer.setData("application/reactflow-kind", kind);
    event.dataTransfer.effectAllowed = "move";
  };

  return (
    <div className="flex w-[152px] shrink-0 flex-col overflow-y-auto border-r border-[var(--color-hairline)] bg-[var(--color-surface)]">
      <div className="px-3 pb-1 pt-3 text-[10px] font-semibold tracking-[0.08em] text-[var(--color-ink-subtle)]">
        节点面板
      </div>

      {PALETTE_GROUPS.map((group) => {
        const GroupIcon = group.icon;
        return (
          <div key={group.label} className="mb-1">
            <div className="flex items-center gap-1.5 px-3 pb-0.5 pt-1.5 text-[10px] font-medium text-[var(--color-ink-tertiary)]">
              <GroupIcon className="size-3" />
              <span>{group.label}</span>
            </div>

            {group.items.map((item) => {
              const ItemIcon = item.icon;
              return (
                <div
                  key={item.kind ? `${item.type}:${item.kind}` : item.type}
                  draggable
                  onDragStart={(e) => onDragStart(e, item.type, item.kind)}
                  className={cn(
                    "mx-2 mb-px flex cursor-grab select-none items-center gap-2 rounded-md border border-transparent px-2.5 py-1.5 text-[11px] text-[var(--color-ink)] transition-colors",
                    "hover:border-[var(--color-hairline)] hover:bg-[var(--color-surface-2)]",
                  )}
                >
                  <ItemIcon
                    className="size-3.5 shrink-0"
                    style={{ color: `var(${NODE_TYPE_VISUALS[item.type].colorVar})` }}
                  />
                  <span>{item.label}</span>
                </div>
              );
            })}
          </div>
        );
      })}

      <div className="flex-1" />

      <div className="border-t border-[var(--color-hairline)] px-3 py-2.5 text-[10px] leading-relaxed text-[var(--color-ink-tertiary)]">
        拖入画布摆放
        <br />
        素材组拖出即带预设的图片节点
      </div>
    </div>
  );
}

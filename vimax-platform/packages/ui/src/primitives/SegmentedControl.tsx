"use client";

import { type ReactNode } from "react";
import { cn } from "../cn";

export interface SegmentedControlItem {
  value: string;
  label: ReactNode;
  icon?: ReactNode;
}

export interface SegmentedControlProps {
  items: SegmentedControlItem[];
  value: string;
  onChange: (value: string) => void;
  /** sm = 筛选行用；md = 主模式切换用 */
  size?: "sm" | "md";
  /** 占满容器宽度（各项等分），适合移动端 */
  fullWidth?: boolean;
  ariaLabel?: string;
  className?: string;
}

/**
 * 分段切换控件 — 模式切换 / 筛选切换的统一来源。
 * 替代此前散落 4+ 处的本地实现（首页模式、explore 筛选、assets 筛选等）。
 */
export function SegmentedControl({
  items,
  value,
  onChange,
  size = "md",
  fullWidth,
  ariaLabel,
  className,
}: SegmentedControlProps) {
  return (
    <div
      role="tablist"
      aria-label={ariaLabel}
      className={cn(
        "inline-flex rounded-full border border-[var(--color-hairline)] bg-[var(--color-surface-1)] p-1",
        fullWidth && "flex w-full",
        className,
      )}
    >
      {items.map((item) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(item.value)}
            className={cn(
              "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full font-medium transition-colors duration-[var(--duration-fast,150ms)]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-focus)]",
              size === "sm" ? "px-3 py-1 text-xs" : "px-5 py-2 text-sm",
              fullWidth && "flex-1",
              active
                ? "bg-[var(--color-accent)] text-[var(--color-accent-on)] shadow-[var(--shadow-accent-sm)]"
                : "text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]",
            )}
          >
            {item.icon}
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

"use client";

import { type ButtonHTMLAttributes, type ReactNode } from "react";
import { cn } from "../cn";

export interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** 可访问名称 —— icon-only 按钮必填，作为 aria-label 与默认 title */
  label: string;
  variant?: "ghost" | "outline" | "accent";
  size?: "sm" | "md";
  children: ReactNode;
}

/**
 * 图标按钮 — 统一焦点环、尺寸与变体。
 * 强制 label 属性，杜绝无名称的可点击图标。
 */
export function IconButton({
  label,
  variant = "ghost",
  size = "md",
  className,
  children,
  ...rest
}: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={label}
      title={rest.title ?? label}
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-md transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-focus)]",
        "disabled:cursor-not-allowed disabled:opacity-40",
        size === "sm" ? "size-7" : "size-9",
        variant === "ghost" &&
          "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]",
        variant === "outline" &&
          "border border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]",
        variant === "accent" &&
          "bg-[var(--color-accent)] text-[var(--color-accent-on)] hover:bg-[var(--color-accent-hover)]",
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

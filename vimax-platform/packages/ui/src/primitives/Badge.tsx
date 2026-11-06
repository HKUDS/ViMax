"use client";

import { type HTMLAttributes } from "react";
import { cn } from "../cn";

type BadgeVariant = "default" | "success" | "warning" | "danger" | "accent";

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  dot?: boolean;
}

const variantStyles: Record<BadgeVariant, string> = {
  default: "bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)]",
  success: "bg-[var(--color-success)]/10 text-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]/10 text-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]/10 text-[var(--color-danger)]",
  accent: "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]",
};

const dotColors: Record<BadgeVariant, string> = {
  default: "bg-[var(--color-text-muted)]",
  success: "bg-[var(--color-success)]",
  warning: "bg-[var(--color-warning)]",
  danger: "bg-[var(--color-danger)]",
  accent: "bg-[var(--color-accent)]",
};

export function Badge({
  variant = "default",
  dot = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium",
        variantStyles[variant],
        className,
      )}
      {...props}
    >
      {dot && (
        <span
          className={cn("size-1.5 rounded-full shrink-0", dotColors[variant])}
        />
      )}
      {children}
    </span>
  );
}

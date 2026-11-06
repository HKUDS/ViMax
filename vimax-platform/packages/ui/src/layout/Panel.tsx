"use client";

import { type HTMLAttributes } from "react";
import { cn } from "../cn";

export interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Panel width in pixels */
  width?: number;
  /** Minimum width */
  minWidth?: number;
}

export function Panel({
  width = 300,
  minWidth = 200,
  className,
  style,
  children,
  ...props
}: PanelProps) {
  return (
    <div
      className={cn(
        "flex flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] overflow-y-auto",
        className,
      )}
      style={{ width, minWidth, ...style }}
      {...props}
    >
      {children}
    </div>
  );
}

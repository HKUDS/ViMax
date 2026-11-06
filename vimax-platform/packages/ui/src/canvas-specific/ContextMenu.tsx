"use client";

import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../cn";

export interface ContextMenuItem {
  label: string;
  icon?: ReactNode;
  onClick: () => void;
  danger?: boolean;
  disabled?: boolean;
}

export interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
  className?: string;
}

export function ContextMenu({ x, y, items, onClose, className }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("click", handler);
    document.addEventListener("keydown", keyHandler);
    return () => {
      document.removeEventListener("click", handler);
      document.removeEventListener("keydown", keyHandler);
    };
  }, [onClose]);

  // Adjust position to stay within viewport
  const adjustedX = Math.min(x, window.innerWidth - 200);
  const adjustedY = Math.min(y, window.innerHeight - items.length * 36 - 16);

  return (
    <div
      ref={ref}
      className={cn(
        "fixed z-[150] min-w-[160px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-xl py-1 animate-in fade-in",
        className,
      )}
      style={{ left: adjustedX, top: adjustedY }}
    >
      {items.map((item, idx) => (
        <button
          key={idx}
          onClick={() => {
            if (!item.disabled) {
              item.onClick();
              onClose();
            }
          }}
          disabled={item.disabled}
          className={cn(
            "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors",
            item.danger
              ? "text-[var(--color-danger)] hover:bg-[var(--color-danger-subtle)]"
              : "text-[var(--color-text)] hover:bg-[var(--color-surface)]",
            item.disabled && "opacity-40 cursor-not-allowed",
          )}
        >
          {item.icon && <span className="shrink-0">{item.icon}</span>}
          <span className="flex-1">{item.label}</span>
        </button>
      ))}
    </div>
  );
}

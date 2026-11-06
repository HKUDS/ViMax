"use client";

import { useState, useRef, useEffect, type ReactNode } from "react";
import { cn } from "../cn";

export interface DropdownMenuProps {
  trigger: ReactNode;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
}

export function DropdownMenu({
  trigger,
  children,
  align = "end",
  className,
}: DropdownMenuProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    if (open) {
      document.addEventListener("click", handleClick);
      document.addEventListener("keydown", handleKey);
      return () => {
        document.removeEventListener("click", handleClick);
        document.removeEventListener("keydown", handleKey);
      };
    }
  }, [open]);

  return (
    <div ref={ref} className="relative inline-flex">
      <div onClick={() => setOpen(!open)} className="cursor-pointer">
        {trigger}
      </div>
      {open && (
        <div
          className={cn(
            "absolute top-full mt-1 z-50 min-w-[160px] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-elevated)] shadow-lg py-1 animate-in fade-in",
            align === "end" ? "right-0" : "left-0",
            className,
          )}
        >
          {children}
        </div>
      )}
    </div>
  );
}

export interface DropdownItemProps {
  children: ReactNode;
  onClick?: () => void;
  danger?: boolean;
  className?: string;
}

export function DropdownItem({ children, onClick, danger, className }: DropdownItemProps) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 px-3 py-1.5 text-sm text-left transition-colors",
        danger
          ? "text-[var(--color-danger)] hover:bg-[var(--color-danger-subtle)]"
          : "text-[var(--color-text)] hover:bg-[var(--color-surface)]",
        className,
      )}
    >
      {children}
    </button>
  );
}

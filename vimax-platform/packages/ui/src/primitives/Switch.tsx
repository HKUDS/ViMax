"use client";

import { type ButtonHTMLAttributes } from "react";
import { cn } from "../cn";

export interface SwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "onChange"> {
  checked?: boolean;
  onChange?: (checked: boolean) => void;
  disabled?: boolean;
}

export function Switch({
  checked = false,
  onChange,
  disabled,
  className,
  ...props
}: SwitchProps) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange?.(!checked)}
      disabled={disabled}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1",
        checked ? "bg-[var(--color-accent)]" : "bg-[var(--color-border)]",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
      {...props}
    >
      <span
        className={cn(
          "absolute top-0.5 size-4 rounded-full bg-white transition-transform",
          checked ? "left-[18px]" : "left-0.5",
        )}
      />
    </button>
  );
}

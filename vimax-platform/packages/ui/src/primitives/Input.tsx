"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

export interface InputProps extends ComponentPropsWithoutRef<"input"> {
  error?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        <input
          ref={ref}
          className={cn(
            "h-10 w-full rounded-xl border bg-[var(--color-bg)] px-3.5 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] transition-all duration-200",
            "border-[var(--color-border)] hover:border-[var(--color-border-hover)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]/20 focus-visible:border-[var(--color-accent)]",
            "disabled:opacity-50 disabled:pointer-events-none",
            error && "border-[var(--color-danger)] focus-visible:ring-[var(--color-danger)]",
            className,
          )}
          {...props}
        />
        {error && (
          <span className="text-xs text-[var(--color-danger)]">{error}</span>
        )}
      </div>
    );
  },
);

Input.displayName = "Input";

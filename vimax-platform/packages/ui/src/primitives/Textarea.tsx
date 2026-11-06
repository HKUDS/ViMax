"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";

export interface TextareaProps extends ComponentPropsWithoutRef<"textarea"> {
  error?: string;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <div className="flex flex-col gap-1">
        <textarea
          ref={ref}
          className={cn(
            "min-h-[80px] w-full rounded-lg border bg-[var(--color-bg)] px-3 py-2 text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] transition-colors duration-[var(--transition-fast)] resize-y",
            "border-[var(--color-border)] hover:border-[var(--color-border-hover)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg)]",
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

Textarea.displayName = "Textarea";

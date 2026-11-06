"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import { cn } from "../cn";

export interface ErrorFallbackProps {
  error: Error;
  onRetry?: () => void;
  title?: string;
  className?: string;
}

export function ErrorFallback({
  error,
  onRetry,
  title = "Something went wrong",
  className,
}: ErrorFallbackProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center justify-center gap-4 p-8 rounded-lg border border-[var(--color-danger)]/30 bg-[var(--color-danger-subtle)]",
        className,
      )}
    >
      <AlertTriangle className="size-8 text-[var(--color-danger)]" />
      <div className="text-center">
        <h3 className="text-sm font-semibold text-[var(--color-text)]">
          {title}
        </h3>
        <p className="mt-1 text-xs text-[var(--color-text-muted)] max-w-md break-all">
          {error.message || "An unexpected error occurred."}
        </p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--color-surface-elevated)] px-3 py-1.5 text-xs font-medium text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-border-hover)] transition-colors"
        >
          <RefreshCw className="size-3" />
          Retry
        </button>
      )}
    </div>
  );
}

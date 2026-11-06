"use client";

import {
  useEffect,
  useRef,
  useCallback,
  type ReactNode,
} from "react";
import { cn } from "../cn";
import { X } from "lucide-react";

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title?: string;
  description?: string;
  children?: ReactNode;
  footer?: ReactNode;
  size?: "sm" | "md" | "lg";
  className?: string;
}

const sizeStyles: Record<string, string> = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
};

export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
  className,
}: DialogProps) {
  const overlayRef = useRef<HTMLDivElement>(null);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        document.body.style.overflow = "";
      };
    }
  }, [open, handleKeyDown]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-in fade-in"
      onClick={(e) => {
        if (e.target === overlayRef.current) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? "dialog-title" : undefined}
        aria-describedby={description ? "dialog-desc" : undefined}
        className={cn(
          "w-full rounded-xl bg-[var(--color-surface)] border border-[var(--color-border)] shadow-xl",
          sizeStyles[size],
          className,
        )}
      >
        {/* Header */}
        {(title || description) && (
          <div className="flex items-start justify-between gap-4 px-5 pt-5 pb-2">
            <div>
              {title && (
                <h2 id="dialog-title" className="text-base font-semibold text-[var(--color-text)]">
                  {title}
                </h2>
              )}
              {description && (
                <p id="dialog-desc" className="text-sm text-[var(--color-text-muted)] mt-0.5">
                  {description}
                </p>
              )}
            </div>
            <button
              onClick={onClose}
              className="shrink-0 rounded-md p-1 text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] transition-colors"
              aria-label="Close"
            >
              <X className="size-4" />
            </button>
          </div>
        )}

        {/* Body */}
        {children && <div className="px-5 py-3">{children}</div>}

        {/* Footer */}
        {footer && (
          <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-[var(--color-border)]">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** Confirmation dialog helper */
export interface ConfirmDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: "danger" | "default";
}

export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  variant = "default",
}: ConfirmDialogProps) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      footer={
        <>
          <button
            onClick={onClose}
            className="h-9 rounded-lg border border-[var(--color-border)] px-4 text-sm font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] transition-colors"
          >
            {cancelLabel}
          </button>
          <button
            onClick={() => { onConfirm(); onClose(); }}
            className={cn(
              "h-9 rounded-lg px-4 text-sm font-medium text-white transition-colors",
              variant === "danger"
                ? "bg-[var(--color-danger)] hover:opacity-90"
                : "bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]",
            )}
          >
            {confirmLabel}
          </button>
        </>
      }
    />
  );
}

"use client";

import { Toaster as SonnerToaster, toast } from "sonner";
import type { ExternalToast } from "sonner";

export type ToastVariant = "success" | "error" | "info" | "warning";

export interface ToastOptions extends Omit<ExternalToast, "description"> {
  description?: React.ReactNode;
}

/** Typed toast function with variant methods */
export interface ToastFn {
  (message: string, opts?: ToastOptions): string | number;
  success: (message: string, opts?: ToastOptions) => string | number;
  error: (message: string, opts?: ToastOptions) => string | number;
  info: (message: string, opts?: ToastOptions) => string | number;
  warning: (message: string, opts?: ToastOptions) => string | number;
}

export interface UseToastReturn {
  toast: ToastFn;
  dismiss: (toastId?: string | number) => void;
  promise: typeof toast.promise;
}

/**
 * Thin wrapper over sonner's Toaster configured for the ViMax design system.
 * Mount this once in the root layout.
 */
export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        style: {
          background: "var(--color-surface)",
          color: "var(--color-text)",
          border: "1px solid var(--color-border)",
          borderRadius: "var(--radius-md, 8px)",
          fontSize: "0.875rem",
        },
      }}
      closeButton
      richColors={false}
      gap={8}
    />
  );
}

function baseNotify(message: string, opts?: ToastOptions): string | number {
  return toast(message, opts);
}

const notify: ToastFn = Object.assign(baseNotify, {
  success: (message: string, opts?: ToastOptions) =>
    toast.success(message, {
      ...opts,
      style: {
        background: "var(--color-surface)",
        color: "var(--color-text)",
        border: "1px solid var(--color-success)",
        borderRadius: "var(--radius-md, 8px)",
        fontSize: "0.875rem",
        ...(opts?.style as object),
      },
    }),
  error: (message: string, opts?: ToastOptions) =>
    toast.error(message, {
      ...opts,
      style: {
        background: "var(--color-surface)",
        color: "var(--color-text)",
        border: "1px solid var(--color-danger)",
        borderRadius: "var(--radius-md, 8px)",
        fontSize: "0.875rem",
        ...(opts?.style as object),
      },
    }),
  info: (message: string, opts?: ToastOptions) =>
    toast(message, {
      ...opts,
      style: {
        background: "var(--color-surface)",
        color: "var(--color-text)",
        border: "1px solid var(--color-accent)",
        borderRadius: "var(--radius-md, 8px)",
        fontSize: "0.875rem",
        ...(opts?.style as object),
      },
    }),
  warning: (message: string, opts?: ToastOptions) =>
    toast(message, {
      ...opts,
      style: {
        background: "var(--color-surface)",
        color: "var(--color-text)",
        border: "1px solid var(--color-warning)",
        borderRadius: "var(--radius-md, 8px)",
        fontSize: "0.875rem",
        ...(opts?.style as object),
      },
    }),
});

/** Hook-compatible toast API */
export function useToast(): UseToastReturn {
  return {
    toast: notify,
    dismiss: toast.dismiss,
    promise: toast.promise,
  };
}

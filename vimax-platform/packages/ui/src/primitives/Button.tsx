"use client";

import { forwardRef, type ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";
import { Loader2 } from "lucide-react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends ComponentPropsWithoutRef<"button"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    "bg-[var(--color-accent)] text-[var(--color-accent-on)] hover:bg-[var(--color-accent-hover)] shadow-sm hover:shadow-md active:scale-[0.98] transition-all",
  secondary:
    "bg-[var(--color-surface)] text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface-elevated)] hover:border-[var(--color-border-hover)] hover:shadow-sm active:scale-[0.98] transition-all",
  ghost:
    "text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface)] active:scale-[0.98] transition-all",
  danger:
    "bg-[var(--color-danger)] text-white hover:opacity-90 shadow-sm hover:shadow-md active:scale-[0.98] transition-all",
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: "h-7 px-3 text-xs rounded-lg gap-1.5",
  md: "h-9 px-4 text-sm rounded-lg gap-1.5",
  lg: "h-11 px-6 text-base rounded-lg gap-2",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      loading = false,
      leftIcon,
      rightIcon,
      children,
      className,
      disabled,
      ...props
    },
    ref,
  ) => {
    return (
      <button
        ref={ref}
        className={cn(
          "inline-flex items-center justify-center font-medium transition-colors duration-[var(--transition-fast)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)] focus-visible:ring-offset-1 focus-visible:ring-offset-[var(--color-bg)] disabled:opacity-50 disabled:pointer-events-none select-none",
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        disabled={disabled ?? loading}
        {...props}
      >
        {loading ? (
          <Loader2 className="size-4 animate-spin shrink-0" />
        ) : leftIcon ? (
          <span className="shrink-0">{leftIcon}</span>
        ) : null}
        {children}
        {!loading && rightIcon ? (
          <span className="shrink-0">{rightIcon}</span>
        ) : null}
      </button>
    );
  },
);

Button.displayName = "Button";

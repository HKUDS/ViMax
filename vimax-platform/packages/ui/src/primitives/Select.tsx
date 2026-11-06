"use client";

import { type ComponentPropsWithoutRef } from "react";
import { cn } from "../cn";
import { ChevronDown } from "lucide-react";

export interface SelectOption {
  value: string;
  label: string;
  disabled?: boolean;
}

export interface SelectProps extends Omit<ComponentPropsWithoutRef<"select">, "children"> {
  options: SelectOption[];
  placeholder?: string;
  error?: string;
}

export function Select({
  options,
  placeholder,
  error,
  className,
  ...props
}: SelectProps) {
  return (
    <div className="flex flex-col gap-1">
      <div className="relative">
        <select
          className={cn(
            "h-9 w-full appearance-none rounded-lg border bg-[var(--color-bg)] pl-3 pr-8 text-sm text-[var(--color-text)] transition-colors",
            "border-[var(--color-border)] hover:border-[var(--color-border-hover)]",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent)]",
            "disabled:opacity-50 disabled:pointer-events-none",
            error && "border-[var(--color-danger)]",
            className,
          )}
          {...props}
        >
          {placeholder && (
            <option value="" disabled>
              {placeholder}
            </option>
          )}
          {options.map((opt) => (
            <option key={opt.value} value={opt.value} disabled={opt.disabled}>
              {opt.label}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-2.5 top-1/2 -translate-y-1/2 size-4 text-[var(--color-text-muted)] pointer-events-none" />
      </div>
      {error && (
        <span className="text-xs text-[var(--color-danger)]">{error}</span>
      )}
    </div>
  );
}

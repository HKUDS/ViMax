"use client";

import { type HTMLAttributes } from "react";
import { cn } from "../cn";
import { User } from "lucide-react";

export interface AvatarProps extends HTMLAttributes<HTMLDivElement> {
  src?: string | null;
  name?: string;
  size?: "sm" | "md" | "lg";
  fallback?: string;
}

const sizeStyles = {
  sm: "size-7 text-xs",
  md: "size-8 text-sm",
  lg: "size-10 text-base",
};

const iconSizes = {
  sm: "size-3.5",
  md: "size-4",
  lg: "size-5",
};

export function Avatar({
  src,
  name,
  size = "md",
  fallback,
  className,
  ...props
}: AvatarProps) {
  const initials = name
    ? name.slice(0, 2).toUpperCase()
    : fallback?.slice(0, 2).toUpperCase() ?? "";

  return (
    <div
      className={cn(
        "relative flex items-center justify-center rounded-full bg-[var(--color-accent-subtle)] border border-[var(--color-border)] overflow-hidden shrink-0",
        sizeStyles[size],
        className,
      )}
      title={name ?? fallback}
      {...props}
    >
      {src ? (
        <img
          src={src}
          alt={name ?? ""}
          className="size-full object-cover"
          onError={(e) => {
            (e.target as HTMLImageElement).style.display = "none";
          }}
        />
      ) : initials ? (
        <span className="font-medium text-[var(--color-accent)]">{initials}</span>
      ) : (
        <User className={cn("text-[var(--color-text-muted)]", iconSizes[size])} />
      )}
    </div>
  );
}

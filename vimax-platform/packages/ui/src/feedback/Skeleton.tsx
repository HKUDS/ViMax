"use client";

import { cn } from "../cn";

export interface SkeletonProps {
  className?: string;
  /** Variant shapes */
  variant?: "text" | "heading" | "card" | "image" | "avatar" | "circle";
}

const variantStyles: Record<string, string> = {
  text: "h-4 w-full rounded-md",
  heading: "h-5 w-2/3 rounded-md",
  card: "h-32 w-full rounded-lg",
  image: "h-48 w-full rounded-lg",
  avatar: "h-10 w-10 rounded-full",
  circle: "h-8 w-8 rounded-full",
};

export function Skeleton({ className, variant = "text" }: SkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading"
      className={cn(
        "animate-pulse bg-[var(--color-surface-elevated)]",
        variantStyles[variant],
        className,
      )}
    />
  );
}

/** Pre-composed skeleton patterns */

export function SkeletonCard() {
  return (
    <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
      <Skeleton variant="text" className="w-3/4" />
      <Skeleton variant="text" />
      <Skeleton variant="text" className="w-1/2" />
    </div>
  );
}

export function SkeletonList({ count = 3 }: { count?: number }) {
  return (
    <div className="space-y-3">
      {Array.from({ length: count }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          variant="text"
          className={i === lines - 1 ? "w-2/3" : "w-full"}
        />
      ))}
    </div>
  );
}

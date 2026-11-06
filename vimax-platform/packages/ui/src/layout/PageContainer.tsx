"use client";

import { type HTMLAttributes } from "react";
import { cn } from "../cn";

export interface PageContainerProps extends HTMLAttributes<HTMLDivElement> {
  /** Max width constraint */
  maxWidth?: "sm" | "md" | "lg" | "xl" | "full";
}

const maxWidthStyles: Record<string, string> = {
  sm: "max-w-2xl",
  md: "max-w-4xl",
  lg: "max-w-6xl",
  xl: "max-w-[1400px]",
  full: "max-w-full",
};

export function PageContainer({
  maxWidth = "xl",
  className,
  children,
  ...props
}: PageContainerProps) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8 py-6",
        maxWidthStyles[maxWidth],
        className,
      )}
      {...props}
    >
      {children}
    </div>
  );
}

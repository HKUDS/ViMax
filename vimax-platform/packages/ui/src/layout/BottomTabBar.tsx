"use client";

import { cn } from "../cn";
import type { LucideIcon } from "lucide-react";

export interface BottomTabBarItem {
  href: string;
  label: string;
  icon: LucideIcon;
  active?: boolean;
}

export interface BottomTabBarProps {
  items: BottomTabBarItem[];
  className?: string;
}

/**
 * 移动端底部标签导航（<md 显示）。
 * 5 项以内等宽分布，尊重 iOS 安全区；桌面端由 icon rail / TopNav 承担导航。
 */
export function BottomTabBar({ items, className }: BottomTabBarProps) {
  return (
    <nav
      aria-label="主导航"
      className={cn(
        "z-50 flex shrink-0 border-t border-[var(--color-hairline)] bg-[var(--color-surface)]/95 backdrop-blur-xl md:hidden",
        className,
      )}
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      {items.map(({ href, label, icon: Icon, active }) => (
        <a
          key={href}
          href={href}
          aria-current={active ? "page" : undefined}
          className={cn(
            "flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[10px] font-medium no-underline transition-colors",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[var(--color-accent-focus)]",
            active
              ? "text-[var(--color-accent)]"
              : "text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]",
          )}
        >
          <Icon className="size-5" />
          <span className="max-w-full truncate px-1">{label}</span>
        </a>
      ))}
    </nav>
  );
}

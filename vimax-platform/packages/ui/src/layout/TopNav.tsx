"use client";

import { type ReactNode } from "react";
import { cn } from "../cn";
import { Film } from "lucide-react";

export interface TopNavProps {
  /** Logo / brand element. Defaults to ViMax logo text. */
  logo?: ReactNode;
  /** Navigation links */
  navLinks?: { label: string; href: string; active?: boolean }[];
  /** Center content slot (e.g. search bar) */
  center?: ReactNode;
  /** Right actions slot (e.g. user menu, theme toggle) */
  actions?: ReactNode;
  className?: string;
}

export function TopNav({
  logo,
  navLinks,
  center,
  actions,
  className,
}: TopNavProps) {
  return (
    <header
      className={cn(
        "sticky top-0 z-50 flex items-center h-[56px] px-5 gap-4 border-b border-[var(--color-hairline)]",
        "bg-[var(--color-canvas)]/85 backdrop-blur-xl backdrop-saturate-150",
        className,
      )}
    >
      {/* Logo — Linear-style: lavender mark only */}
      <div className="flex items-center gap-2 shrink-0">
        {logo ?? (
          <a href="/" className="flex items-center gap-2.5 text-[var(--color-ink)] hover:opacity-80 transition-opacity no-underline">
            <div className="flex items-center justify-center w-6 h-6 rounded-md bg-[var(--color-accent)]">
              <Film className="size-3.5 text-[var(--color-accent-on)]" />
            </div>
            <span className="font-semibold text-sm tracking-tight">ViMax</span>
          </a>
        )}
      </div>

      {/* Nav Links — Linear-style: subtle text, accent on active; hidden on mobile (BottomTabBar takes over) */}
      {navLinks && (
        <nav className="ml-2 hidden items-center gap-0.5 md:flex">
          {navLinks.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className={cn(
                "px-3 py-1.5 rounded-md text-[13px] font-medium transition-all duration-200 no-underline",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--color-accent-focus)]",
                link.active
                  ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                  : "text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)] hover:bg-[var(--color-surface-2)]",
              )}
            >
              {link.label}
            </a>
          ))}
        </nav>
      )}

      {/* Center */}
      <div className="flex-1 flex justify-center">{center}</div>

      {/* Right */}
      <div className="flex items-center gap-1.5 shrink-0">{actions}</div>
    </header>
  );
}

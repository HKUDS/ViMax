"use client";

import { type ReactNode } from "react";
import { cn } from "../cn";
import { TopNav, type TopNavProps } from "./TopNav";

export interface AppShellProps {
  /** TopNav configuration. Pass null to hide. */
  topNav?: TopNavProps | null;
  /** Sidebar content. Pass null to hide. */
  sidebar?: ReactNode;
  /** Collapse sidebar to icon-only */
  sidebarCollapsed?: boolean;
  /** Extra classes on the sidebar <aside>, e.g. "hidden lg:flex" to hide on mobile */
  sidebarClassName?: string;
  /** Mobile bottom navigation (<md). Rendered below the body, always visible. */
  bottomNav?: ReactNode;
  /** Main content */
  children: ReactNode;
  /** Additional class on the shell wrapper */
  className?: string;
}

export function AppShell({
  topNav,
  sidebar,
  sidebarCollapsed = false,
  sidebarClassName,
  bottomNav,
  children,
  className,
}: AppShellProps) {
  const sidebarWidth = sidebarCollapsed ? 56 : 220;

  return (
    <div
      className={cn(
        "flex flex-col h-screen bg-[var(--color-bg)] text-[var(--color-text)]",
        className,
      )}
    >
      {/* Top Navigation */}
      {topNav !== null && <TopNav {...(topNav ?? {})} />}

      {/* Body */}
      <div className="flex flex-1 min-h-0">
        {/* Sidebar */}
        {sidebar && (
          <aside
            className={cn(
              "flex-shrink-0 overflow-y-auto bg-transparent py-3 pl-3 transition-all duration-[var(--transition-normal)]",
              sidebarClassName,
            )}
            style={{ width: sidebarWidth }}
          >
            {sidebar}
          </aside>
        )}

        {/* Main Content */}
        <main className="flex-1 overflow-auto">{children}</main>
      </div>

      {/* Mobile bottom navigation */}
      {bottomNav}
    </div>
  );
}

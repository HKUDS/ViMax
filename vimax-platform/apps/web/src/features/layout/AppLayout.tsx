"use client";

import { type ReactNode, useState, useEffect } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import { AppShell, TopNav, BottomTabBar, ErrorBoundary } from "@vimax/ui";
import { useAuth } from "@/features/auth/AuthProvider";
import { useTheme } from "@/features/theme/ThemeProvider";
import { useLocaleSwitch } from "@/i18n/locale";
import { useTranslations } from "next-intl";
import { User, Sun, Moon, Globe, Home, Compass, FolderOpen, Image as ImageIcon, Clapperboard, Settings } from "lucide-react";
import { AuthDialog } from "@/features/auth/AuthCard";
import { CmdKSearch } from "@/features/search/CmdKSearch";
import { KeyboardShortcuts } from "@/features/shortcuts/KeyboardShortcuts";
import { shouldSkipAppShell } from "@/features/canvas/utils/canvas-navigation";
import { StudioSidebar } from "@/features/layout/StudioSidebar";

export function AppLayout({ children }: { children: ReactNode }) {
  const [authOpen, setAuthOpen] = useState(false);
  const pathname = usePathname();
  const { user, isLoading, logout } = useAuth();
  const { resolved, setTheme } = useTheme();
  const { locale, switchLocale } = useLocaleSwitch();
  const t = useTranslations("nav");
  const tc = useTranslations("common");

  // Prevent hydration mismatch by deferring theme icon render to client
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const isAuthPage = pathname === "/login" || pathname === "/signup";
  const isFullscreenPage = shouldSkipAppShell(pathname);

  if (isAuthPage || isFullscreenPage) {
    return <ErrorBoundary>{children}</ErrorBoundary>;
  }

  const navLinks = [
    { label: t("home"), href: "/", active: pathname === "/" },
    { label: t("explore"), href: "/explore", active: pathname === "/explore" },
    { label: tc("assets"), href: "/assets", active: pathname === "/assets" },
    { label: t("studioVideo"), href: "/studio/video", active: pathname === "/studio/video" },
    { label: t("studio"), href: "/studio/image", active: pathname === "/studio/image" },
  ];

  // Mobile bottom tabs (<md)：桌面分组侧栏的移动端等价物
  const mobileTabs = [
    { label: t("home"), href: "/", icon: Home, active: pathname === "/" },
    { label: t("studioVideo"), href: "/studio/video", icon: Clapperboard, active: pathname === "/studio/video" },
    { label: t("studio"), href: "/studio/image", icon: ImageIcon, active: pathname === "/studio/image" },
    { label: tc("assets"), href: "/assets", icon: FolderOpen, active: pathname === "/assets" },
    { label: t("explore"), href: "/explore", icon: Compass, active: pathname === "/explore" },
    { label: tc("settings"), href: "/settings", icon: Settings, active: pathname === "/settings" },
  ];

  return (
    <ErrorBoundary>
      <CmdKSearch />
      <KeyboardShortcuts />
      <AppShell
        topNav={{
          navLinks,
          actions: (
            <>
              {/* Language switcher */}
              <button
                onClick={() => switchLocale(locale === "zh-CN" ? "en" : "zh-CN")}
                className="flex items-center gap-1 px-1.5 py-1 rounded-md text-xs font-medium text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] transition-colors"
                title={locale === "zh-CN" ? "Switch to English" : "切换到中文"}
              >
                <Globe className="size-3.5" />
                {locale === "zh-CN" ? "EN" : "中文"}
              </button>

              {/* Theme toggle — defer render to prevent hydration mismatch */}
              <button
                onClick={() => setTheme(resolved === "dark" ? "light" : "dark")}
                className="p-1.5 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] transition-colors"
                title={mounted ? (resolved === "dark" ? t("switchLight") : t("switchDark")) : undefined}
                suppressHydrationWarning
              >
                {mounted ? (
                  resolved === "dark" ? <Sun className="size-3.5" /> : <Moon className="size-3.5" />
                ) : (
                  <span className="block size-3.5" />
                )}
              </button>

              {isLoading ? (
                <div className="w-7 h-7 rounded-full bg-[var(--color-surface-elevated)] animate-pulse" />
              ) : user ? (
                <div className="flex items-center gap-2">
                  <Link
                    href="/settings"
                    className="flex items-center gap-1.5 px-2 py-1 rounded-md text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] transition-colors no-underline"
                  >
                    <User className="size-3.5" />
                    <span className="max-w-[100px] truncate">{user.name}</span>
                  </Link>
                  <button
                    onClick={logout}
                    className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text)] transition-colors px-2 py-1"
                  >
                    {tc("logout")}
                  </button>
                </div>
              ) : (
                <>
                  <button
                    onClick={() => setAuthOpen(true)}
                    className="flex items-center gap-1 rounded-md bg-[var(--color-accent)] px-2.5 py-1 text-xs font-medium text-[var(--color-accent-on)] transition-colors hover:bg-[var(--color-accent-hover)]"
                  >
                    {tc("login")} / {tc("signup")}
                  </button>
                  <AuthDialog open={authOpen} onClose={() => setAuthOpen(false)} />
                </>
              )}
            </>
          ),
        }}
        sidebar={<StudioSidebar />}
        sidebarClassName="hidden lg:flex"
        bottomNav={<BottomTabBar items={mobileTabs} />}
      >
        {children}
      </AppShell>
    </ErrorBoundary>
  );
}

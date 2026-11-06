"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Clapperboard,
  Compass,
  Cpu,
  Film,
  FolderOpen,
  Home,
  Image as ImageIcon,
  Plus,
  Settings,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { cn } from "@vimax/ui";
import { trpc } from "@/lib/trpc/client";

interface NavItem {
  label: string;
  href: string;
  icon: LucideIcon;
  active: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * Grouped studio sidebar (Stitch console style): creation tools grouped
 * under "Creative Engine", ecosystem links below, settings pinned to the
 * bottom. Mirrors the design's grouped rail with a glowing New Canvas CTA.
 */
export function StudioSidebar() {
  const t = useTranslations("nav");
  const tc = useTranslations("common");
  const pathname = usePathname();
  const router = useRouter();
  const createCanvas = trpc.canvas.create.useMutation();

  const is = (href: string) => (href === "/" ? pathname === "/" : pathname.startsWith(href));

  const groups: NavGroup[] = [
    {
      label: t("groupCreative"),
      items: [
        { label: t("home"), href: "/", icon: Home, active: is("/") },
        { label: t("projects"), href: "/projects", icon: Film, active: is("/projects") },
        { label: t("studioVideo"), href: "/studio/video", icon: Clapperboard, active: is("/studio/video") },
        { label: t("studio"), href: "/studio/image", icon: ImageIcon, active: is("/studio/image") },
        { label: tc("assets"), href: "/assets", icon: FolderOpen, active: is("/assets") },
      ],
    },
    {
      label: t("groupEcosystem"),
      items: [
        { label: t("explore"), href: "/explore", icon: Compass, active: is("/explore") },
        { label: t("models"), href: "/settings/models", icon: Cpu, active: is("/settings/models") },
      ],
    },
  ];

  const handleNewCanvas = async () => {
    try {
      const r = await createCanvas.mutateAsync({
        name: `画布 ${new Date().toLocaleDateString("zh-CN")}`,
      });
      router.push(`/canvas/${r.canvas_id}`);
    } catch {
      // global error handler already toasts unauthorized
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-surface-1)]/90 p-3 shadow-[var(--shadow-lg)] backdrop-blur-xl">
      {/* New Canvas CTA — gradient pill with glow */}
      <button
        type="button"
        onClick={() => void handleNewCanvas()}
        className="flex w-full items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-[var(--color-accent)] to-[var(--color-secondary)] py-2 font-mono text-xs font-semibold text-white shadow-[0_0_16px_rgba(160,120,255,0.35)] transition-all hover:shadow-[0_0_22px_rgba(76,215,246,0.5)]"
      >
        <Plus className="size-4" />
        {t("newCanvas")}
      </button>

      <nav className="flex flex-1 flex-col gap-4">
        {groups.map((group) => (
          <div key={group.label} className="flex flex-col gap-0.5">
            <span className="px-3 pb-1 font-mono text-[10px] font-semibold uppercase tracking-widest text-[var(--color-ink-subtle)]">
              {group.label}
            </span>
            {group.items.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                title={item.label}
                className={cn(
                  "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm no-underline transition-all",
                  item.active
                    ? "bg-[var(--color-accent)] font-semibold text-[var(--color-accent-on)] shadow-[0_0_14px_rgba(160,120,255,0.3)]"
                    : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]",
                )}
              >
                <item.icon className="size-4.5 shrink-0" />
                <span className="truncate">{item.label}</span>
              </Link>
            ))}
          </div>
        ))}
      </nav>

      <div className="flex flex-col gap-0.5 border-t border-[var(--color-hairline)] pt-2">
        <Link
          href="/settings"
          title={tc("settings")}
          className={cn(
            "flex items-center gap-2.5 rounded-xl px-3 py-2 text-sm no-underline transition-all",
            pathname.startsWith("/settings")
              ? "bg-[var(--color-accent)] font-semibold text-[var(--color-accent-on)]"
              : "text-[var(--color-ink-muted)] hover:bg-[var(--color-surface-3)] hover:text-[var(--color-ink)]",
          )}
        >
          <Settings className="size-4.5 shrink-0" />
          <span className="truncate">{tc("settings")}</span>
        </Link>
      </div>
    </div>
  );
}

"use client";

import { useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@vimax/ui";
import { trpc } from "@/lib/trpc/client";
import { Search, FileText, Image, Film, Settings, Home, Plus, ArrowRight, ArrowDown, ArrowUp, CornerDownLeft } from "lucide-react";

interface SearchItem {
  id: string;
  label: string;
  category: "project" | "asset" | "command";
  href?: string;
  icon: ReactNode;
  action?: () => void;
}

const COMMANDS: SearchItem[] = [
  { id: "cmd-home", label: "回到首页", category: "command", href: "/", icon: <Home className="size-4" /> },
  { id: "cmd-new", label: "新建项目", category: "command", href: "/", icon: <Plus className="size-4" /> },
  { id: "cmd-studio", label: "图片生成工作室", category: "command", href: "/studio/image", icon: <Image className="size-4" /> },
  { id: "cmd-assets", label: "资产库", category: "command", href: "/assets", icon: <FileText className="size-4" /> },
  { id: "cmd-settings", label: "设置", category: "command", href: "/settings", icon: <Settings className="size-4" /> },
];

export function CmdKSearch() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIdx, setSelectedIdx] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  // Fetch data for search
  const projectsQuery = trpc.canvas.list.useQuery({ limit: 20 }, { enabled: open, staleTime: 30_000 });
  const assetsQuery = trpc.asset.listAssets.useQuery({}, { enabled: open, staleTime: 30_000 });

  // Toggle with Cmd+K / Ctrl+K
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, []);

  // Auto-focus input
  useEffect(() => {
    if (open) {
      setTimeout(() => inputRef.current?.focus(), 50);
      setQuery("");
      setSelectedIdx(0);
    }
  }, [open]);

  const close = useCallback(() => setOpen(false), []);

  // Build search items
  const items: SearchItem[] = [];

  // Commands
  if (!query) {
    items.push(...COMMANDS);
  }

  // Projects
  const projects = projectsQuery.data?.items ?? [];
  for (const p of projects) {
    if (query && !p.name.toLowerCase().includes(query.toLowerCase())) continue;
    items.push({
      id: `proj-${p.canvas_id}`,
      label: p.name,
      category: "project",
      href: `/canvas/${p.canvas_id}`,
      icon: <Film className="size-4" />,
    });
  }

  // Assets
  const assets = assetsQuery.data?.items ?? [];
  for (const a of assets.slice(0, 10)) {
    if (query && !a.asset_id.toLowerCase().includes(query.toLowerCase())) continue;
    items.push({
      id: `asset-${a.asset_id}`,
      label: `${a.kind} · ${a.asset_id.slice(0, 8)}…`,
      category: "asset",
      icon: <Image className="size-4" />,
    });
  }

  // Filter commands by query
  const filtered = query
    ? [
        ...items.filter((i) => i.category === "command"),
        ...items.filter((i) => i.category !== "command" && i.label.toLowerCase().includes(query.toLowerCase())),
      ].slice(0, 10)
    : items.slice(0, 10);

  const handleSelect = (item: SearchItem) => {
    close();
    if (item.href) router.push(item.href);
    item.action?.();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setSelectedIdx((i) => Math.min(i + 1, filtered.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSelectedIdx((i) => Math.max(i - 1, 0)); }
    if (e.key === "Enter" && filtered[selectedIdx]) handleSelect(filtered[selectedIdx]);
  };

  if (!open) return null;

  const categoryLabels: Record<string, string> = { command: "快捷命令", project: "项目", asset: "资产" };

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[200] flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
      onClick={(e) => { if (e.target === overlayRef.current) close(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl overflow-hidden animate-in fade-in slide-up">
        {/* Search Input */}
        <div className="flex items-center gap-3 px-4 h-12 border-b border-[var(--color-border)]">
          <Search className="size-4 text-[var(--color-text-dim)] shrink-0" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => { setQuery(e.target.value); setSelectedIdx(0); }}
            onKeyDown={handleKeyDown}
            placeholder="搜索项目、资产或命令…"
            className="flex-1 bg-transparent text-sm text-[var(--color-text)] placeholder:text-[var(--color-text-dim)] outline-none"
          />
          <kbd className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-elevated)] text-[var(--color-text-dim)] border border-[var(--color-border)] font-mono">
            ESC
          </kbd>
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <div className="text-center py-8 text-sm text-[var(--color-text-muted)]">无结果</div>
          ) : (
            <>
              {/* Group by category */}
              {(["command", "project", "asset"] as const).map((cat) => {
                const catItems = filtered.filter((i) => i.category === cat);
                if (catItems.length === 0) return null;
                return (
                  <div key={cat} className="mb-1">
                    <div className="px-3 py-1 text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wide">
                      {categoryLabels[cat]}
                    </div>
                    {catItems.map((item) => {
                      const idx = filtered.indexOf(item);
                      return (
                        <button
                          key={item.id}
                          onClick={() => handleSelect(item)}
                          className={cn(
                            "flex items-center gap-3 w-full px-3 py-2 rounded-md text-sm text-left transition-colors",
                            idx === selectedIdx
                              ? "bg-[var(--color-accent-subtle)] text-[var(--color-accent)]"
                              : "text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)]",
                          )}
                        >
                          <span className="text-[var(--color-text-muted)]">{item.icon}</span>
                          <span className="flex-1 truncate">{item.label}</span>
                          <ArrowRight className="size-3 text-[var(--color-text-dim)] opacity-0 group-hover:opacity-100" />
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center gap-4 px-4 h-8 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-dim)]">
          <span className="flex items-center gap-1.5">
            <span className="flex items-center rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 py-px">
              <ArrowUp className="size-2.5" />
              <ArrowDown className="size-2.5" />
            </span>
            导航
          </span>
          <span className="flex items-center gap-1.5">
            <span className="flex items-center rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 py-px">
              <CornerDownLeft className="size-2.5" />
            </span>
            选择
          </span>
          <span className="flex items-center gap-1.5">
            <span className="rounded border border-[var(--color-border)] bg-[var(--color-surface-2)] px-1 py-px font-mono">ESC</span>
            关闭
          </span>
        </div>
      </div>
    </div>
  );
}

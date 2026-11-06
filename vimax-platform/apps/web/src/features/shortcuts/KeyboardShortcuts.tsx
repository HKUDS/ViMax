"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { cn } from "@vimax/ui";
import { X, Search, Undo2, Redo2, Trash2, Copy, MousePointer2, ZoomIn, ZoomOut, Maximize2, Play, Scissors, Save, Download } from "lucide-react";

// ── Shortcut Definitions ────────────────────────────────────────────

interface Shortcut {
  keys: string[];
  label: string;
  icon?: React.ReactNode;
}

interface ShortcutGroup {
  title: string;
  shortcuts: Shortcut[];
}

const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: "全局",
    shortcuts: [
      { keys: ["Ctrl", "K"], label: "全局搜索", icon: <Search className="size-3.5" /> },
      { keys: ["Ctrl", "T"], label: "切换主题", icon: <Search className="size-3.5" /> },
      { keys: ["?"], label: "显示快捷键", icon: <Search className="size-3.5" /> },
    ],
  },
  {
    title: "画布",
    shortcuts: [
      { keys: ["Ctrl", "Z"], label: "撤销", icon: <Undo2 className="size-3.5" /> },
      { keys: ["Ctrl", "Shift", "Z"], label: "重做", icon: <Redo2 className="size-3.5" /> },
      { keys: ["Delete"], label: "删除选中节点", icon: <Trash2 className="size-3.5" /> },
      { keys: ["Ctrl", "D"], label: "复制选中节点", icon: <Copy className="size-3.5" /> },
      { keys: ["Ctrl", "A"], label: "全选", icon: <MousePointer2 className="size-3.5" /> },
      { keys: ["鼠标拖拽"], label: "平移画布", icon: <MousePointer2 className="size-3.5" /> },
      { keys: ["Shift", "拖拽"], label: "框选节点", icon: <MousePointer2 className="size-3.5" /> },
      { keys: ["滚轮"], label: "以鼠标位置为中心缩放", icon: <ZoomIn className="size-3.5" /> },
      { keys: ["Ctrl", "+"], label: "放大", icon: <ZoomIn className="size-3.5" /> },
      { keys: ["Ctrl", "-"], label: "缩小", icon: <ZoomOut className="size-3.5" /> },
      { keys: ["Ctrl", "0"], label: "适应画布", icon: <Maximize2 className="size-3.5" /> },
    ],
  },
  {
    title: "工作台",
    shortcuts: [
      { keys: ["Space"], label: "播放/暂停", icon: <Play className="size-3.5" /> },
      { keys: ["S"], label: "切割片段", icon: <Scissors className="size-3.5" /> },
      { keys: ["Ctrl", "S"], label: "保存项目", icon: <Save className="size-3.5" /> },
      { keys: ["Ctrl", "E"], label: "导出视频", icon: <Download className="size-3.5" /> },
    ],
  },
];

// ── Kbd Component ────────────────────────────────────────────────────

function Kbd({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="inline-flex items-center justify-center min-w-[24px] h-5 px-1.5 rounded text-[10px] font-medium bg-[var(--color-surface-elevated)] text-[var(--color-text-muted)] border border-[var(--color-border)] font-mono shadow-sm">
      {children}
    </kbd>
  );
}

// ── Dialog Component ─────────────────────────────────────────────────

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);
  const overlayRef = useRef<HTMLDivElement>(null);

  const toggle = useCallback(() => setOpen((v) => !v), []);
  const close = useCallback(() => setOpen(false), []);

  // Listen for "?" key to toggle
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't trigger when typing in inputs
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable) return;

      if (e.key === "?" && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        toggle();
      }
      if (e.key === "Escape" && open) {
        close();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [toggle, close, open]);

  if (!open) return null;

  return (
    <div
      ref={overlayRef}
      className="fixed inset-0 z-[250] flex items-start justify-center pt-[10vh] bg-black/50 backdrop-blur-sm animate-in fade-in"
      onClick={(e) => { if (e.target === overlayRef.current) close(); }}
    >
      <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 h-12 border-b border-[var(--color-border)]">
          <h2 className="text-sm font-semibold text-[var(--color-text)]">键盘快捷键</h2>
          <button
            onClick={close}
            className="p-1 rounded-md text-[var(--color-text-muted)] hover:text-[var(--color-text)] hover:bg-[var(--color-surface-elevated)] transition-colors"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Shortcut Groups */}
        <div className="max-h-[60vh] overflow-y-auto p-4 space-y-5">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.title}>
              <h3 className="text-[10px] font-semibold text-[var(--color-text-dim)] uppercase tracking-wide mb-2 px-1">
                {group.title}
              </h3>
              <div className="space-y-0.5">
                {group.shortcuts.map((shortcut) => (
                  <div
                    key={shortcut.label}
                    className="flex items-center justify-between px-2 py-2 rounded-lg hover:bg-[var(--color-surface-elevated)] transition-colors"
                  >
                    <div className="flex items-center gap-2.5">
                      {shortcut.icon && (
                        <span className="text-[var(--color-text-muted)]">{shortcut.icon}</span>
                      )}
                      <span className="text-sm text-[var(--color-text)]">{shortcut.label}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      {shortcut.keys.map((key, i) => (
                        <span key={i} className="flex items-center gap-1">
                          {i > 0 && <span className="text-[10px] text-[var(--color-text-dim)]">+</span>}
                          <Kbd>{key}</Kbd>
                        </span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        {/* Footer hint */}
        <div className="flex items-center gap-2 px-4 h-9 border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-dim)]">
          <span>按 <Kbd>?</Kbd> 打开/关闭此面板</span>
          <span>·</span>
          <span><Kbd>ESC</Kbd> 关闭</span>
        </div>
      </div>
    </div>
  );
}

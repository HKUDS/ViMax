"use client";

import { type ReactNode } from "react";
import { cn } from "../cn";

export interface PageHeaderProps {
  title: ReactNode;
  description?: ReactNode;
  /** 右侧动作区（按钮 / 筛选控件等） */
  actions?: ReactNode;
  className?: string;
}

/**
 * 页面标题区 — 各页面标题层级的统一来源：
 * headline 字阶 + muted 描述 + 右侧动作槽，移动端自动换行。
 */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn("flex flex-wrap items-end justify-between gap-3", className)}>
      <div className="min-w-0">
        <h1 className="text-[var(--text-headline)] font-semibold leading-[var(--leading-normal)] tracking-[var(--tracking-headline)] text-[var(--color-ink)]">
          {title}
        </h1>
        {description && (
          <p className="mt-1 text-[13px] leading-[var(--leading-relaxed)] text-[var(--color-ink-subtle)]">
            {description}
          </p>
        )}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

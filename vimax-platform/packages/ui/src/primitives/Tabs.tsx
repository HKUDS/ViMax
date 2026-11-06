"use client";

import { type ReactNode, useState, useCallback } from "react";
import { cn } from "../cn";

export interface Tab {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
}

export interface TabsProps {
  tabs: Tab[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  className?: string;
  children?: ReactNode;
}

export function Tabs({
  tabs,
  activeTab: controlledTab,
  onTabChange,
  className,
  children,
}: TabsProps) {
  const [internalTab, setInternalTab] = useState(tabs[0]?.id ?? "");
  const activeTab = controlledTab ?? internalTab;

  const handleTabChange = useCallback(
    (tabId: string) => {
      setInternalTab(tabId);
      onTabChange?.(tabId);
    },
    [onTabChange],
  );

  return (
    <div className={cn("flex flex-col", className)}>
      <div className="flex border-b border-[var(--color-border)]" role="tablist">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={activeTab === tab.id}
            onClick={() => handleTabChange(tab.id)}
            className={cn(
              "flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors",
              activeTab === tab.id
                ? "border-[var(--color-accent)] text-[var(--color-accent)]"
                : "border-transparent text-[var(--color-text-muted)] hover:text-[var(--color-text)]",
            )}
          >
            {tab.icon}
            {tab.label}
          </button>
        ))}
      </div>
      {children}
    </div>
  );
}

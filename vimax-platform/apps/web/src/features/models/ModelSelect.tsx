"use client";

import { trpc } from "@/lib/trpc/client";
import type { ModelType } from "@vimax/contracts";
import { cn } from "@vimax/ui";

// ── ModelSelect Props ──────────────────────────────────────────────────

export interface ModelSelectProps {
  /** Filter models by type */
  type: ModelType;
  /** Currently selected model ID */
  value: string;
  /** Change handler */
  onChange: (modelId: string) => void;
  /** Optional CSS class */
  className?: string;
  /** Placeholder text when no model selected */
  placeholder?: string;
  /** Disable the selector */
  disabled?: boolean;
  /** Compact mode (smaller padding, smaller font) for inline use on nodes */
  compact?: boolean;
}

// ── ModelSelect Component ──────────────────────────────────────────────
// Reusable model selector dropdown. Fetches models from the DB-backed
// tRPC endpoint and renders them grouped by provider.
// Used on home page, chat panel, settings, and canvas nodes.

export function ModelSelect({
  type,
  value,
  onChange,
  className,
  placeholder,
  disabled,
  compact,
}: ModelSelectProps) {
  const { data, isLoading } = trpc.modelConfig.list.useQuery(
    { type },
    { staleTime: 60_000 },
  );

  const models = data?.items ?? [];

  // Group models by provider
  const grouped: Record<string, typeof models> = {};
  for (const m of models) {
    const prov = m.provider ?? "unknown";
    if (!grouped[prov]) grouped[prov] = [];
    grouped[prov]!.push(m);
  }

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    onChange(e.target.value);
  };

  return (
    <select
      value={value}
      onChange={handleChange}
      disabled={disabled || isLoading}
      className={cn(
        "appearance-none rounded-lg border font-[var(--font-sans)] outline-none transition-colors",
        compact
          ? "px-2 py-1 text-[10px] border-[var(--color-border)] bg-[var(--color-bg)] text-[var(--color-text)]"
          : "px-3 py-2 text-xs border-[var(--color-hairline)] bg-[var(--color-surface-1)] text-[var(--color-text)]",
        "hover:border-[var(--color-hairline-strong)] focus:border-[var(--color-accent)]",
        disabled && "opacity-50 cursor-not-allowed",
        className,
      )}
      style={
        compact
          ? {
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
              backgroundRepeat: "no-repeat",
              backgroundPosition: "right 4px center",
              paddingRight: "20px",
            }
          : undefined
      }
    >
      {isLoading ? (
        <option value="">加载中…</option>
      ) : (
        <>
          {placeholder && (
            <option value="">{placeholder}</option>
          )}
          {Object.entries(grouped).map(([provider, providerModels]) => (
            <optgroup key={provider} label={provider}>
              {providerModels.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                  {m.isDefault ? "（默认）" : ""}
                </option>
              ))}
            </optgroup>
          ))}
          {models.length === 0 && !isLoading && (
            <option value="">无可用模型</option>
          )}
        </>
      )}
    </select>
  );
}

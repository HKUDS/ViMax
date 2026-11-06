"use client";

import { useMemo, useState } from "react";
import {
  NEGATIVE_WORD_GROUPS,
  PROMPT_THESAURUS,
  type NegativeWord,
} from "@vimax/contracts";

/** 逗号分隔词条的追加/移除（限制词 chips 与自由输入共用一份文本）。 */
export function togglePromptWord(text: string, en: string): string {
  const parts = text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const idx = parts.findIndex((p) => p.toLowerCase() === en.toLowerCase());
  if (idx >= 0) parts.splice(idx, 1);
  else parts.push(en);
  return parts.join(", ");
}

const CHIP =
  "rounded-full border px-2 py-0.5 text-[11px] transition-colors border-[var(--color-hairline)]";

/** 限制词预设 chips：点击在 value 中加入/移除词条，与自由输入框同源。 */
export function NegativePromptChips({
  value,
  onChange,
  includeVideoGroup = false,
}: {
  value: string;
  onChange: (v: string) => void;
  includeVideoGroup?: boolean;
}) {
  const selected = useMemo(
    () =>
      new Set(
        value
          .split(",")
          .map((s) => s.trim().toLowerCase())
          .filter(Boolean),
      ),
    [value],
  );

  const groups = NEGATIVE_WORD_GROUPS.filter((g) => includeVideoGroup || !g.videoOnly);

  return (
    <div className="flex flex-col gap-1.5">
      {groups.map((g) => (
        <div key={g.id} className="flex flex-wrap items-center gap-1">
          <span className="w-14 shrink-0 text-[10px] text-[var(--color-ink-tertiary)]">
            {g.label}
          </span>
          {g.words.map((w: NegativeWord) => {
            const active = selected.has(w.en.toLowerCase());
            return (
              <button
                key={w.id}
                type="button"
                aria-pressed={active}
                title={w.en}
                onClick={() => onChange(togglePromptWord(value, w.en))}
                className={
                  active
                    ? `${CHIP} border-transparent bg-[var(--color-accent)] text-[var(--color-accent-on)]`
                    : `${CHIP} bg-[var(--color-surface-2)] text-[var(--color-ink-subtle)] hover:text-[var(--color-ink)]`
                }
              >
                {w.label}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}

/** 联想词板块：维度 tab + 词条 chips，点击把英文片段追加进 prompt。 */
export function ThesaurusChips({ onAppend }: { onAppend: (fragment: string) => void }) {
  const [dim, setDim] = useState(PROMPT_THESAURUS[0].id);
  const words = PROMPT_THESAURUS.find((d) => d.id === dim)?.words ?? [];

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap gap-1">
        {PROMPT_THESAURUS.map((d) => (
          <button
            key={d.id}
            type="button"
            aria-pressed={d.id === dim}
            onClick={() => setDim(d.id)}
            className={
              d.id === dim
                ? "rounded-md bg-[var(--color-surface-3)] px-2 py-0.5 text-[11px] font-medium text-[var(--color-ink)]"
                : "rounded-md px-2 py-0.5 text-[11px] text-[var(--color-ink-subtle)] transition-colors hover:text-[var(--color-ink)]"
            }
          >
            {d.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-1">
        {words.map((w) => (
          <button
            key={w.id}
            type="button"
            title={w.en}
            onClick={() => onAppend(w.en)}
            className={`${CHIP} bg-[var(--color-surface-2)] text-[var(--color-ink-subtle)] hover:border-[var(--color-accent)] hover:text-[var(--color-accent)]`}
          >
            {w.label}
          </button>
        ))}
      </div>
    </div>
  );
}

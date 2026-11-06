"use client";

import { useState } from "react";
import { useCanvas } from "../canvas-context";

interface InlineEditTextProps {
  nodeId: string;
  field: string;
  value: string;
  placeholder?: string;
  clampLines?: number;
  rows?: number;
}

/**
 * Double-click-to-edit text for canvas node bodies. Render state shows a
 * clamped preview; editing swaps in a textarea. Enter commits, Escape cancels,
 * Shift+Enter inserts a newline. `nodrag`/`nowheel` keep React Flow from
 * hijacking the interaction.
 */
export function InlineEditText({
  nodeId,
  field,
  value,
  placeholder,
  clampLines,
  rows = 3,
}: InlineEditTextProps) {
  const { handleUpdateNodeData } = useCanvas();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  if (!editing) {
    return (
      <p
        className="nodrag"
        title="双击编辑"
        onDoubleClick={(e) => {
          e.stopPropagation();
          setDraft(value);
          setEditing(true);
        }}
        style={{
          color: value ? "var(--color-text-muted)" : "var(--color-text-dim)",
          fontSize: 11,
          margin: 0,
          cursor: "text",
          ...(clampLines
            ? {
                display: "-webkit-box",
                WebkitLineClamp: clampLines,
                WebkitBoxOrient: "vertical",
                overflow: "hidden",
              }
            : {}),
        }}
      >
        {value || placeholder}
      </p>
    );
  }

  return (
    <textarea
      className="nodrag nowheel"
      autoFocus
      value={draft}
      rows={rows}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => {
        setEditing(false);
        if (draft !== value) handleUpdateNodeData(nodeId, field, draft);
      }}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape") {
          setDraft(value);
          setEditing(false);
        }
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          e.currentTarget.blur();
        }
      }}
      style={{
        width: "100%",
        fontSize: 11,
        lineHeight: 1.5,
        padding: 4,
        borderRadius: 4,
        border: "1px solid var(--color-accent)",
        backgroundColor: "var(--color-bg)",
        color: "var(--color-text)",
        resize: "vertical",
        boxSizing: "border-box",
        fontFamily: "inherit",
      }}
    />
  );
}

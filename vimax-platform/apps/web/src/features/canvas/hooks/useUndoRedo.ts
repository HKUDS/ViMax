"use client";

import { useCallback, useRef, useState } from "react";
import type { Node, Edge } from "@xyflow/react";

interface HistoryEntry {
  nodes: Node[];
  edges: Edge[];
}

const MAX_HISTORY = 50;

export function useUndoRedo() {
  const undoStackRef = useRef<HistoryEntry[]>([]);
  const redoStackRef = useRef<HistoryEntry[]>([]);
  const [canUndo, setCanUndo] = useState(false);
  const [canRedo, setCanRedo] = useState(false);

  /** Push current state onto undo stack before a mutation */
  const snapshot = useCallback((nodes: Node[], edges: Edge[]) => {
    undoStackRef.current.push({
      nodes: nodes.map((n) => ({ ...n, position: { ...n.position }, data: n.data ? { ...n.data } : {} as Record<string, unknown> })),
      edges: edges.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined })),
    });
    if (undoStackRef.current.length > MAX_HISTORY) {
      undoStackRef.current.shift();
    }
    redoStackRef.current = [];
    setCanUndo(undoStackRef.current.length > 0);
    setCanRedo(false);
  }, []);

  /** Undo: restore previous state from undo stack */
  const undo = useCallback(
    (currentNodes: Node[], currentEdges: Edge[]): HistoryEntry | null => {
      const prev = undoStackRef.current.pop();
      if (!prev) return null;

      // Push current state to redo stack
      redoStackRef.current.push({
        nodes: currentNodes.map((n) => ({ ...n, position: { ...n.position }, data: n.data ? { ...n.data } : {} as Record<string, unknown> })),
        edges: currentEdges.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined })),
      });

      setCanUndo(undoStackRef.current.length > 0);
      setCanRedo(true);
      return prev;
    },
    [],
  );

  /** Redo: restore previously undone state */
  const redo = useCallback(
    (currentNodes: Node[], currentEdges: Edge[]): HistoryEntry | null => {
      const next = redoStackRef.current.pop();
      if (!next) return null;

      // Push current state to undo stack
      undoStackRef.current.push({
        nodes: currentNodes.map((n) => ({ ...n, position: { ...n.position }, data: n.data ? { ...n.data } : {} as Record<string, unknown> })),
        edges: currentEdges.map((e) => ({ ...e, data: e.data ? { ...e.data } : undefined })),
      });

      setCanUndo(true);
      setCanRedo(redoStackRef.current.length > 0);
      return next;
    },
    [],
  );

  /** Clear all history */
  const clear = useCallback(() => {
    undoStackRef.current = [];
    redoStackRef.current = [];
    setCanUndo(false);
    setCanRedo(false);
  }, []);

  return { snapshot, undo, redo, clear, canUndo, canRedo, undoStackRef, redoStackRef };
}

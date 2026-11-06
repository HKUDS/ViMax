"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ClientWsMessage,
  ServerWsMessage,
} from "@vimax/contracts";
import { sharedCanvasWs } from "./shared-ws";

interface UseCanvasWebSocketOptions {
  canvasId: string;
  onMessage?: (msg: ServerWsMessage) => void;
  enabled?: boolean;
}

interface UseCanvasWebSocketReturn {
  status: "connecting" | "connected" | "disconnected" | "error";
  send: (msg: ClientWsMessage) => void;
  error: string | null;
  reconnect: () => void;
}

export function useCanvasWebSocket({
  canvasId,
  onMessage,
  enabled = true,
}: UseCanvasWebSocketOptions): UseCanvasWebSocketReturn {
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;
  const [status, setStatus] = useState<
    "connecting" | "connected" | "disconnected" | "error"
  >("disconnected");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled || !canvasId) return;

    const unsubscribe = sharedCanvasWs.subscribe(
      canvasId,
      (msg) => onMessageRef.current?.(msg),
      setStatus,
    );

    return unsubscribe;
  }, [canvasId, enabled]);

  const send = useCallback((msg: ClientWsMessage) => {
    sharedCanvasWs.send(msg);
  }, []);

  const reconnect = useCallback(() => {
    setError(null);
  }, []);

  useEffect(() => {
    if (status === "error") {
      setError("WebSocket connection error");
    } else {
      setError(null);
    }
  }, [status]);

  return { status, send, error, reconnect };
}

export { sharedCanvasWs };

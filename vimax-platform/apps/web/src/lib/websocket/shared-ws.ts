"use client";

import type { ClientWsMessage, ServerWsMessage } from "@vimax/contracts";

type Subscriber = (msg: ServerWsMessage) => void;
type StatusListener = (
  status: "connecting" | "connected" | "disconnected" | "error",
) => void;

function getWsUrl(): string {
  const apiBase = (
    process.env.NEXT_PUBLIC_API_URL?.replace(/\/trpc\/?$/, "") ||
    "http://localhost:3001"
  ).replace(/\/+$/, "");
  const base = apiBase.replace(/^http/, "ws") + "/ws";
  if (typeof window !== "undefined") {
    const token = localStorage.getItem("vimax-access-token");
    if (token) return `${base}?token=${encodeURIComponent(token)}`;
  }
  return base;
}

class SharedCanvasWebSocket {
  private ws: WebSocket | null = null;
  private canvasId: string | null = null;
  private subscribers = new Set<Subscriber>();
  private statusListeners = new Set<StatusListener>();
  private reconnectTimeout: ReturnType<typeof setTimeout> | undefined;
  private reconnectAttempts = 0;
  private status: "connecting" | "connected" | "disconnected" | "error" =
    "disconnected";

  subscribe(
    canvasId: string,
    onMessage: Subscriber,
    onStatus?: StatusListener,
  ): () => void {
    this.subscribers.add(onMessage);
    if (onStatus) {
      onStatus(this.status);
      this.statusListeners.add(onStatus);
    }

    if (this.canvasId !== canvasId) {
      this.canvasId = canvasId;
      this.connect();
    } else if (!this.ws || this.ws.readyState === WebSocket.CLOSED) {
      this.connect();
    }

    return () => {
      this.subscribers.delete(onMessage);
      if (onStatus) this.statusListeners.delete(onStatus);
      if (this.subscribers.size === 0) {
        this.disconnect();
      }
    };
  }

  get connected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }

  send(msg: ClientWsMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    } else {
      console.warn("[ws] Cannot send: not connected");
    }
  }

  private setStatus(
    status: "connecting" | "connected" | "disconnected" | "error",
  ): void {
    this.status = status;
    for (const listener of this.statusListeners) {
      listener(status);
    }
  }

  private connect(): void {
    if (!this.canvasId || this.subscribers.size === 0) return;

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }

    const url = getWsUrl();
    this.setStatus("connecting");

    try {
      const ws = new WebSocket(url);
      this.ws = ws;

      ws.onopen = () => {
        if (this.ws !== ws) return;
        this.setStatus("connected");
        this.reconnectAttempts = 0;
        ws.send(
          JSON.stringify({
            type: "chat.subscribe",
            canvasId: this.canvasId!,
          } satisfies ClientWsMessage),
        );
      };

      ws.onmessage = (event) => {
        if (this.ws !== ws) return;
        try {
          const msg = JSON.parse(event.data as string) as ServerWsMessage;
          for (const sub of this.subscribers) {
            sub(msg);
          }
        } catch (err) {
          console.error("[ws] Failed to parse message:", err);
        }
      };

      ws.onclose = () => {
        if (this.ws !== ws) return;
        this.ws = null;
        this.setStatus("disconnected");
        if (this.subscribers.size > 0 && this.canvasId) {
          const delay = Math.min(
            1000 * Math.pow(2, this.reconnectAttempts),
            30000,
          );
          this.reconnectAttempts++;
          this.reconnectTimeout = setTimeout(() => this.connect(), delay);
        }
      };

      ws.onerror = () => {
        if (this.ws !== ws) return;
        this.setStatus("error");
      };
    } catch {
      this.setStatus("error");
    }
  }

  private disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = undefined;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.canvasId = null;
    this.setStatus("disconnected");
  }
}

export const sharedCanvasWs = new SharedCanvasWebSocket();

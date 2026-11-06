import type WebSocket from "ws";
import type { ServerWsMessage } from "@vimax/contracts";

// ── Connection Manager ──────────────────────────────────────────────
// Manages WebSocket connections organized by canvas "rooms".
// Each canvas gets its own room; messages broadcast to a room reach
// all clients viewing that canvas.

interface ManagedConnection {
  ws: WebSocket;
  canvasId: string | null;
  /** Authenticated user id, bound at WS upgrade time. */
  userId: string;
  subscribedConversations: Set<string>; // conversationIds this conn is tracking
}

const connections = new Map<WebSocket, ManagedConnection>();

/**
 * Register a new WebSocket connection.
 */
export function addConnection(ws: WebSocket, userId: string): void {
  connections.set(ws, {
    ws,
    canvasId: null,
    userId,
    subscribedConversations: new Set(),
  });
}

/** The authenticated user id bound to this connection at upgrade time. */
export function getUserId(ws: WebSocket): string | null {
  return connections.get(ws)?.userId ?? null;
}

/**
 * Remove a WebSocket connection and clean up room membership.
 */
export function removeConnection(ws: WebSocket): void {
  connections.delete(ws);
}

/**
 * Associate a connection with a canvas room.
 */
export function joinRoom(ws: WebSocket, canvasId: string): void {
  const conn = connections.get(ws);
  if (conn) {
    conn.canvasId = canvasId;
  }
}

/**
 * Subscribe a connection to a specific conversation's events.
 */
export function subscribeConversation(
  ws: WebSocket,
  conversationId: string,
): void {
  const conn = connections.get(ws);
  if (conn) {
    conn.subscribedConversations.add(conversationId);
  }
}

/**
 * Unsubscribe a connection from a specific conversation's events.
 */
export function unsubscribeConversation(
  ws: WebSocket,
  conversationId: string,
): void {
  const conn = connections.get(ws);
  if (conn) {
    conn.subscribedConversations.delete(conversationId);
  }
}

/**
 * Broadcast a message to all connections in a canvas room.
 */
export function broadcastToRoom(
  canvasId: string,
  message: ServerWsMessage,
): void {
  const payload = JSON.stringify(message);
  for (const conn of connections.values()) {
    if (conn.canvasId === canvasId && conn.ws.readyState === 1) {
      conn.ws.send(payload);
    }
  }
}

/**
 * Broadcast a message to all connections in a canvas room except the
 * sender — used for presence relay so clients never see their own cursor.
 */
export function broadcastToRoomExcept(
  canvasId: string,
  except: WebSocket,
  message: ServerWsMessage,
): void {
  const payload = JSON.stringify(message);
  for (const conn of connections.values()) {
    if (
      conn.ws !== except &&
      conn.canvasId === canvasId &&
      conn.ws.readyState === 1
    ) {
      conn.ws.send(payload);
    }
  }
}

/**
 * Send a message to all connections subscribed to a conversation.
 * Also sends to connections in the same canvas room (for chat events).
 */
export function broadcastToConversation(
  conversationId: string,
  message: ServerWsMessage,
): void {
  const payload = JSON.stringify(message);
  for (const conn of connections.values()) {
    if (
      conn.subscribedConversations.has(conversationId) &&
      conn.ws.readyState === 1
    ) {
      conn.ws.send(payload);
    }
  }
}

/**
 * Send a message to a single connection.
 */
export function sendToConnection(
  ws: WebSocket,
  message: ServerWsMessage,
): void {
  if (ws.readyState === 1) {
    ws.send(JSON.stringify(message));
  }
}

/**
 * Get the canvasId for a connection (if any).
 */
export function getCanvasId(ws: WebSocket): string | null {
  return connections.get(ws)?.canvasId ?? null;
}

/**
 * Get the count of active connections in a room.
 */
export function getRoomSize(canvasId: string): number {
  let count = 0;
  for (const conn of connections.values()) {
    if (conn.canvasId === canvasId) count++;
  }
  return count;
}

/**
 * Get total active connections count.
 */
export function getTotalConnections(): number {
  return connections.size;
}

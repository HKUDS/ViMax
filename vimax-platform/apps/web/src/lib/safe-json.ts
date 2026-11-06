/**
 * Parse an SSE frame payload without letting a malformed/empty frame
 * crash the page — a half-flushed stream must degrade to the fallback,
 * not white-screen the studio.
 */
export function safeJsonParse<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

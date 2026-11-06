const PREFIX = "vimax:prompt-sent:";

export function markPromptSent(canvasId: string, prompt: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.setItem(`${PREFIX}${canvasId}`, prompt);
}

export function wasPromptSent(canvasId: string, prompt: string): boolean {
  if (typeof window === "undefined") return false;
  return sessionStorage.getItem(`${PREFIX}${canvasId}`) === prompt;
}

export function clearPromptSent(canvasId: string): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(`${PREFIX}${canvasId}`);
}

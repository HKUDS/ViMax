import type { JobEventValidated } from "@vimax/contracts";

type Listener = (event: JobEventValidated) => void;

const listeners = new Map<string, Set<Listener>>();

export function subscribeJobEvents(jobId: string, listener: Listener): () => void {
  const set = listeners.get(jobId) ?? new Set<Listener>();
  set.add(listener);
  listeners.set(jobId, set);

  return () => {
    set.delete(listener);
    if (set.size === 0) {
      listeners.delete(jobId);
    }
  };
}

export function broadcastJobEvent(jobId: string, event: JobEventValidated): void {
  const set = listeners.get(jobId);
  if (!set) {
    return;
  }
  for (const listener of set) {
    listener(event);
  }
}

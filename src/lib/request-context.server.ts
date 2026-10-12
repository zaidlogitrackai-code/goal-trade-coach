// Server-only: per-request access to the host's waitUntil, so work the user started
// (an AI reply) still finishes and is saved when the phone drops the connection.
import { AsyncLocalStorage } from "node:async_hooks";

type HostCtx = { waitUntil?: (p: Promise<unknown>) => void };
export const requestContext = new AsyncLocalStorage<HostCtx>();

/** Keep `p` running after the response/disconnect when the host supports it. */
export function keepAlive(p: Promise<unknown>): void {
  const ctx = requestContext.getStore();
  try { ctx?.waitUntil?.(p.catch(() => {})); } catch { /* host without waitUntil: the promise still runs */ }
}

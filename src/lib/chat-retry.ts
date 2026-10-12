/**
 * Chat delivery helpers: a dropped phone connection must never lose a reply.
 * Pure (no React / DOM) so the rules are unit-tested.
 */

export const IMAGE_NOTE = "\n📎 (صورة مرفقة)";

/** Browser-level network failure (connection dropped, offline, request killed). */
export function isNetworkError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e ?? "");
  return (e instanceof TypeError && /fetch|network|load failed/i.test(msg)) || /failed to fetch|networkerror|load failed|network request failed/i.test(msg);
}

/** Arabic message the user can act on; never the raw English browser error. */
export function friendlyError(e: unknown): string {
  if (isNetworkError(e)) return "انقطع الاتصال وما وصل الرد. اضغط «أعد المحاولة».";
  const msg = e instanceof Error ? e.message : "";
  return /[\u0600-\u06FF]/.test(msg) ? msg : "تعذّر الرد، اضغط «أعد المحاولة».";
}

export interface ChatRow { role: string; content: string }

/** On a retry, the user's message is already saved when the last row is that same message. */
export function shouldSkipUserInsert(last: ChatRow | null | undefined, storedContent: string): boolean {
  return !!last && last.role === "user" && retryText(last.content) === retryText(storedContent);
}

export type RetryDecision = "fresh" | "skip-insert" | "already-answered";

/**
 * What a resend should do, given the newest rows of the thread (newest first):
 * - "already-answered": the message and its reply are both saved (only the response was lost) → return that reply.
 * - "skip-insert": the message is saved but unanswered → answer it without saving it twice.
 * - "fresh": the message never arrived → save and answer it normally.
 */
export function retryDecision(newestFirst: ChatRow[], storedContent: string): RetryDecision {
  const [a, b] = newestFirst;
  if (shouldSkipUserInsert(a, storedContent)) return "skip-insert";
  if (a?.role === "assistant" && shouldSkipUserInsert(b, storedContent)) return "already-answered";
  return "fresh";
}

/** The last user message that never got an answer (shown with a retry button). */
export function unansweredMessage<T extends ChatRow>(list: T[]): T | null {
  const last = list[list.length - 1];
  return last && last.role === "user" ? last : null;
}

/** The text to resend for an unanswered message (drops the image marker). */
export function retryText(content: string): string {
  return content.endsWith(IMAGE_NOTE) ? content.slice(0, -IMAGE_NOTE.length) : content;
}

export type Delivery<T> = { kind: "reply"; value: T } | { kind: "answered" } | { kind: "pending" };

/**
 * Send once. On a network drop the server keeps working, so first watch the thread:
 * - the reply shows up → "answered" (no second AI call);
 * - the message never arrived → resend once as a retry;
 * - still unanswered after `maxWaitMs` → "pending" (the chat shows a retry button).
 */
export async function sendReliably<T>(
  call: (retry: boolean) => Promise<T>,
  check: () => Promise<RetryDecision>,
  { pollMs = 2500, maxWaitMs = 45_000 }: { pollMs?: number; maxWaitMs?: number } = {},
): Promise<Delivery<T>> {
  try {
    return { kind: "reply", value: await call(false) };
  } catch (e) {
    if (!isNetworkError(e)) throw e;
  }
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  for (let waited = 0; waited <= maxWaitMs; waited += pollMs) {
    let state: RetryDecision;
    try { state = await check(); } catch { await sleep(pollMs); continue; }
    if (state === "already-answered") return { kind: "answered" };
    if (state === "fresh") return { kind: "reply", value: await call(true) };
    await sleep(pollMs);
  }
  return { kind: "pending" };
}

/** Send once; on a network drop, wait and resend once as a retry (server skips the duplicate). */
export async function sendWithRetry<T>(call: (retry: boolean) => Promise<T>, waitMs = 1500): Promise<T> {
  try {
    return await call(false);
  } catch (e) {
    if (!isNetworkError(e)) throw e;
    await new Promise((r) => setTimeout(r, waitMs));
    return call(true);
  }
}

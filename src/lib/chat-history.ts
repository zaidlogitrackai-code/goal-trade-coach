/**
 * What the model sees of a chat thread. Pure so the rules are unit-tested:
 * - the message being answered goes in exactly once (as the image turn when there
 *   is one) — it is already saved in the thread, so pushing it again doubled it;
 * - each earlier reply carries what its actions really did, so the model doesn't
 *   assume a trade it "logged" was saved when it failed or still waits for a click.
 */
import { retryText } from "./chat-retry";

/** Turns sent to the model per reply, the message being answered included. */
export const HISTORY_LIMIT = 40;

export type HistoryRow = { role: string; content: string; actions?: unknown };
type Part = { type: "input_text"; text: string } | { type: "input_image"; image_url: string; detail: "high" };
export type ModelTurn = { role: string; content: string | Part[] };

/** One '[نتيجة: …]' line per action stored on a reply, as its card last recorded it. */
export function actionOutcomes(actions: unknown): string[] {
  if (!Array.isArray(actions)) return [];
  return actions.flatMap((a) => {
    if (!a || typeof a !== "object") return [];
    const { summary, type, status, note } = a as Record<string, unknown>;
    const what = typeof summary === "string" && summary.trim() ? summary.trim() : typeof type === "string" ? type : "إجراء";
    const why = typeof note === "string" && note.trim() ? note.trim() : "";
    const result =
      status === "done" ? (why ? `تم (${why})` : "تم")
      : status === "failed" ? (why ? `فشل: ${why}` : "فشل")
      : status === "rejected" ? "رفضه هادي"
      // No status: never ran — waiting for his click, or the card was never opened.
      : why ? `ما تنفّذ، ينتظر موافقة هادي (${why})` : "ما تنفّذ، ينتظر موافقة هادي";
    return [`[نتيجة: ${what} — ${result}]`];
  });
}

function toTurn(row: HistoryRow): ModelTurn {
  const lines = row.role === "assistant" ? actionOutcomes(row.actions) : [];
  return { role: row.role, content: lines.length ? `${row.content}\n${lines.join("\n")}` : row.content };
}

/**
 * Model input from the thread's rows (oldest first) and the message being answered.
 * The current message is normally the last saved row; it is dropped from the history
 * when the image turn carries it, and appended when it isn't there. Keeps the newest
 * `limit` turns in chronological order.
 */
export function toModelInput(
  rows: HistoryRow[],
  current: string,
  { image, limit = HISTORY_LIMIT }: { image?: string | undefined; limit?: number } = {},
): ModelTurn[] {
  const last = rows[rows.length - 1];
  const saved = last && last.role === "user" && retryText(last.content) === retryText(current) ? last : null;
  const earlier = saved ? rows.slice(0, -1) : rows;
  const past = earlier.slice(Math.max(0, earlier.length - (limit - 1))).map(toTurn);
  const now: ModelTurn = image
    ? { role: "user", content: [{ type: "input_text", text: current }, { type: "input_image", image_url: image, detail: "high" }] }
    // Keep the saved text: after a reload it still says an image was attached.
    : { role: "user", content: saved ? saved.content : current };
  return [...past, now];
}

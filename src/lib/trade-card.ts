/** Parses + validates the ```trade block the analyst appends to every analysis. Pure. */
export interface TradeCard {
  direction: "buy" | "sell" | "none";
  entry_from: number | null;
  entry_to: number | null;
  sl: number | null;
  tp1: number | null;
  tp2: number | null;
  rr: number | null;
  confidence: string | null;
  skills: string[];
  no_trade_reason: string | null;
}

export type ParsedCard = { ok: true; card: TradeCard } | { ok: false; error: string };

const BLOCK = /```trade\s*([\s\S]*?)```/;
const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);

export function splitTradeBlock(text: string): { body: string; raw: string | null } {
  const m = text.match(BLOCK);
  return m ? { body: text.replace(BLOCK, "").trim(), raw: (m[1] ?? "").trim() } : { body: text, raw: null };
}

export function parseTradeCard(raw: string): ParsedCard {
  let j: Partial<Record<"direction" | "entry_from" | "entry_to" | "sl" | "tp1" | "tp2" | "confidence" | "skills" | "no_trade_reason", unknown>>;
  try { j = JSON.parse(raw); } catch { return { ok: false, error: "صيغة البطاقة غير صحيحة" }; }
  const d = String(j.direction ?? "none").toLowerCase();
  const direction = d === "buy" || d === "sell" ? d : "none";
  const card: TradeCard = {
    direction,
    entry_from: num(j.entry_from), entry_to: num(j.entry_to) ?? num(j.entry_from),
    sl: num(j.sl), tp1: num(j.tp1), tp2: num(j.tp2), rr: null,
    confidence: j.confidence ? String(j.confidence) : null,
    skills: Array.isArray(j.skills) ? j.skills.map(String).slice(0, 6) : [],
    no_trade_reason: j.no_trade_reason ? String(j.no_trade_reason) : null,
  };
  if (direction === "none") return { ok: true, card };
  const { entry_from: a, entry_to: b, sl, tp1, tp2 } = card;
  if (a == null || b == null || sl == null || tp1 == null) return { ok: false, error: "أرقام ناقصة" };
  const mid = (a + b) / 2;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (direction === "buy") {
    if (!(sl < lo && tp1 > hi && (tp2 == null || tp2 > tp1))) return { ok: false, error: "الأرقام متناقضة" };
  } else if (!(sl > hi && tp1 < lo && (tp2 == null || tp2 < tp1))) return { ok: false, error: "الأرقام متناقضة" };
  const risk = Math.abs(mid - sl);
  card.rr = risk > 0 ? Math.round((Math.abs((tp2 ?? tp1) - mid) / risk) * 10) / 10 : null;
  return { ok: true, card };
}

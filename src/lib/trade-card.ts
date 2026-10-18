/** Parses + validates the ```trade block the analyst appends to every analysis. Pure. */
import { symbolByKey } from "./market-symbols";
import { lotForRisk, riskUsd } from "./trade-idea";

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
  style: "scalp" | "intraday" | "swing" | null;
  hold: string | null;
  /** One of the nine keys (XAUUSD…); null when the analyst didn't name it. */
  symbol: string | null;
  timeframe: string | null;
  strategy: string | null;
  /** watch = «راقبها»: an idea to follow, not an entry. */
  intent: "trade" | "watch";
  /** The analyst's own one-line gate read («الشروط مكتملة» / «ناقصه تأكيد»). */
  gate: string | null;
}

export type ParsedCard = { ok: true; card: TradeCard } | { ok: false; error: string };

const BLOCK = /```trade\s*([\s\S]*?)```/;
const num = (v: unknown) => (v == null || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const str = (v: unknown, max: number) => (v == null ? null : String(v).trim().slice(0, max) || null);

function normStyle(v: unknown): TradeCard["style"] {
  const t = String(v ?? "").toLowerCase();
  if (/scalp|سكالب/.test(t)) return "scalp";
  if (/swing|سوينق|سوينج/.test(t)) return "swing";
  if (/intraday|day|يوم/.test(t)) return "intraday";
  return null;
}

// Volume Analysis needs real traded volume; spot forex has none, so that skill can't have agreed.
const VOLUME_SKILL = /volume|فوليوم|حجم/i;

export function splitTradeBlock(text: string): { body: string; raw: string | null } {
  const m = text.match(BLOCK);
  return m ? { body: text.replace(BLOCK, "").trim(), raw: (m[1] ?? "").trim() } : { body: text, raw: null };
}

export function parseTradeCard(raw: string): ParsedCard {
  type Key = "direction" | "entry_from" | "entry_to" | "sl" | "tp1" | "tp2" | "confidence" | "skills" | "no_trade_reason" | "style" | "hold" | "symbol" | "timeframe" | "strategy" | "intent" | "gate";
  let j: Partial<Record<Key, unknown>>;
  try {
    const v: unknown = JSON.parse(raw);
    if (!v || typeof v !== "object" || Array.isArray(v)) throw new Error();
    j = v as Partial<Record<Key, unknown>>;
  } catch { return { ok: false, error: "صيغة البطاقة غير صحيحة" }; }
  const d = String(j.direction ?? "none").toLowerCase();
  const direction = d === "buy" || d === "sell" ? d : "none";
  const sym = symbolByKey(str(j.symbol, 20));
  const skills = Array.isArray(j.skills) ? j.skills.map(String).slice(0, 6) : [];
  const card: TradeCard = {
    direction,
    entry_from: num(j.entry_from), entry_to: num(j.entry_to) ?? num(j.entry_from),
    sl: num(j.sl), tp1: num(j.tp1), tp2: num(j.tp2), rr: null,
    confidence: j.confidence ? String(j.confidence) : null,
    skills: sym && !sym.volume ? skills.filter((s) => !VOLUME_SKILL.test(s)) : skills,
    no_trade_reason: j.no_trade_reason ? String(j.no_trade_reason) : null,
    style: normStyle(j.style),
    hold: str(j.hold, 40),
    symbol: sym?.key ?? null,
    timeframe: str(j.timeframe, 20),
    strategy: str(j.strategy, 60),
    intent: /watch|راقب/i.test(String(j.intent ?? "")) ? "watch" : "trade",
    gate: str(j.gate, 120),
  };
  if (direction === "none") return { ok: true, card };
  const { entry_from: a, entry_to: b, sl, tp1, tp2 } = card;
  // A watch idea may stop at the direction and a zone; a trade needs every number.
  if (a == null || b == null || sl == null || tp1 == null) return card.intent === "watch" ? { ok: true, card } : { ok: false, error: "أرقام ناقصة" };
  const mid = (a + b) / 2;
  const lo = Math.min(a, b), hi = Math.max(a, b);
  if (direction === "buy") {
    if (!(sl < lo && tp1 > hi && (tp2 == null || tp2 > tp1))) return { ok: false, error: "الأرقام متناقضة" };
  } else if (!(sl > hi && tp1 < lo && (tp2 == null || tp2 < tp1))) return { ok: false, error: "الأرقام متناقضة" };
  const risk = Math.abs(mid - sl);
  card.rr = risk > 0 ? Math.round((Math.abs((tp2 ?? tp1) - mid) / risk) * 10) / 10 : null;
  return { ok: true, card };
}

/** The entry the stepper is handed: the middle of the zone, at the symbol's precision. */
export function cardEntry(c: TradeCard): number | null {
  if (c.entry_from == null || c.entry_to == null) return null;
  const digits = symbolByKey(c.symbol)?.digits ?? 5;
  return Number(((c.entry_from + c.entry_to) / 2).toFixed(digits));
}

/** Lots that fit his per-trade risk, and the $ that size actually risks at the card's stop. */
export function cardSizing(c: TradeCard, maxRiskUsd: number): { lots: number; risk: number } | null {
  const e = cardEntry(c);
  if (!c.symbol || e == null || c.sl == null || !(maxRiskUsd > 0)) return null;
  const lots = lotForRisk(c.symbol, e, c.sl, maxRiskUsd);
  return { lots, risk: lots > 0 ? riskUsd(c.symbol, e, c.sl, lots) : 0 };
}

/** Search params for /new-trade: the gate stepper opens prefilled with this card. */
export type CardSearch = { symbol?: string; direction?: "buy" | "sell"; entry?: number; sl?: number; tp?: number; analysis_id?: string };

export function cardToSearch(c: TradeCard, analysisId?: string | null): CardSearch {
  const out: CardSearch = {};
  if (c.symbol) out.symbol = c.symbol;
  if (c.direction !== "none") out.direction = c.direction;
  const e = cardEntry(c);
  if (e != null) out.entry = e;
  if (c.sl != null) out.sl = c.sl;
  if (c.tp1 != null) out.tp = c.tp1;
  if (analysisId) out.analysis_id = analysisId;
  return out;
}

/** The /new-trade URL for a card; a plain href so this doesn't wait on that route's search schema. */
export function cardHref(c: TradeCard, analysisId?: string | null): string {
  const q = new URLSearchParams(Object.entries(cardToSearch(c, analysisId)).map(([k, v]) => [k, String(v)]));
  const s = q.toString();
  return s ? `/new-trade?${s}` : "/new-trade";
}

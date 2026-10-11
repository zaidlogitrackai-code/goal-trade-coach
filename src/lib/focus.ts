import { z } from "zod";
import { forexSymbol } from "./forex";

/**
 * The trader's focus profile: what they told the coach (or typed) about themselves.
 * Stored as one hidden row in knowledge_notes so it needs no schema change.
 * Pure module: safe to import on both client and server.
 */
export const FOCUS_CATEGORY = "__focus";
export const FOCUS_TITLE = "ملف التركيز";
const MAX_NOTES = 12;

const text = z.string().trim().max(300).nullable().catch(null);

export const FocusSchema = z.object({
  markets: z.array(z.string().max(30)).max(10).catch([]),
  goal: text,
  weakness: text,
  focus_rule: text,
  style: text,
  notes: z.array(z.string().max(300)).max(MAX_NOTES).catch([]),
  updated_at: z.string().nullable().catch(null),
});
export type FocusProfile = z.infer<typeof FocusSchema>;

export const EMPTY_FOCUS: FocusProfile = {
  markets: [],
  goal: null,
  weakness: null,
  focus_rule: null,
  style: null,
  notes: [],
  updated_at: null,
};

export function parseFocus(content: string | null | undefined): FocusProfile {
  if (!content) return { ...EMPTY_FOCUS };
  try {
    const r = FocusSchema.safeParse({ ...EMPTY_FOCUS, ...JSON.parse(content) });
    return r.success ? r.data : { ...EMPTY_FOCUS };
  } catch {
    return { ...EMPTY_FOCUS };
  }
}

export const isFocusEmpty = (f: FocusProfile) =>
  f.markets.length === 0 &&
  !f.goal &&
  !f.weakness &&
  !f.focus_rule &&
  !f.style &&
  f.notes.length === 0;

// ---------- markets ----------

/** Broad words for the whole Forex market; a trade can't be judged against them. */
const CATEGORIES = new Set(["فوركس", "FOREX", "FX", "عملات", "الكل", "ALL"]);

export function normSymbol(s: string): string {
  return (
    forexSymbol(s) ??
    s
      .trim()
      .toUpperCase()
      .replace(/[\s/._-]/g, "")
  );
}

/** "ذهب، EUR/USD و nas100" -> ["XAUUSD", "EURUSD"]: non-Forex markets are dropped. */
export function splitMarkets(input: string | string[] | null | undefined): string[] {
  const parts = Array.isArray(input) ? input : (input ?? "").split(/[,،;|\n]+|\s+و\s+|\s+/);
  const out: string[] = [];
  for (const p of parts) {
    const t = p.trim();
    if (!t) continue;
    const n = CATEGORIES.has(t.toUpperCase()) || CATEGORIES.has(t) ? t : forexSymbol(t);
    if (n && !out.includes(n)) out.push(n);
  }
  return out.slice(0, 10);
}

/**
 * Is the symbol inside the listed markets? null when the list is empty or only
 * broad (category words), meaning "can't tell" rather than "outside".
 */
export function inMarkets(symbol: string | null | undefined, markets: string[]): boolean | null {
  const specific = markets.filter((m) => !CATEGORIES.has(m.toUpperCase()) && !CATEGORIES.has(m));
  if (!symbol || specific.length === 0) return null;
  const s = normSymbol(symbol);
  return specific.some((m) => {
    const n = normSymbol(m);
    return n === s || (n.length >= 3 && s.startsWith(n)) || (s.length >= 3 && n.startsWith(s));
  });
}

// ---------- patches (from the coach or the edit form) ----------

export type FocusPatch = {
  markets?: string | string[] | null;
  goal?: string | null;
  weakness?: string | null;
  focus_rule?: string | null;
  style?: string | null;
  add_note?: string | null;
  remove_note?: string | null;
};

const clean = (v: string | null | undefined) => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, 300) : null;
};

export function mergeFocus(cur: FocusProfile, p: FocusPatch, now = new Date()): FocusProfile {
  const next: FocusProfile = { ...cur, notes: [...cur.notes] };
  if (p.markets !== undefined) next.markets = splitMarkets(p.markets ?? []);
  for (const k of ["goal", "weakness", "focus_rule", "style"] as const)
    if (p[k] !== undefined) next[k] = clean(p[k]);
  const rm = clean(p.remove_note);
  if (rm) next.notes = next.notes.filter((n) => !n.includes(rm));
  const add = clean(p.add_note);
  if (add && !next.notes.includes(add)) next.notes = [...next.notes, add].slice(-MAX_NOTES);
  next.updated_at = now.toISOString();
  return next;
}

/** Short Arabic block for the AI prompt. */
export function focusForPrompt(f: FocusProfile): string {
  if (isFocusEmpty(f))
    return "ملف التركيز فارغ: اسأله عن سوقه وهدفه ونقطة ضعفه واحفظها بـ update_focus.";
  return [
    f.markets.length ? `الأسواق: ${f.markets.join("، ")}` : null,
    f.style ? `الأسلوب: ${f.style}` : null,
    f.goal ? `الهدف الحالي: ${f.goal}` : null,
    f.weakness ? `نقطة الضعف: ${f.weakness}` : null,
    f.focus_rule ? `القاعدة المركز عليها: ${f.focus_rule}` : null,
    f.notes.length ? `ملاحظات تذكرها عنه: ${f.notes.join(" | ")}` : null,
  ]
    .filter(Boolean)
    .join("\n");
}

// ---------- signals derived from what they actually did ----------

export type SignalTrade = {
  symbol: string;
  status: string;
  pnl: number | null;
  emotion: string | null;
  strategy_id: string | null;
  stop_loss: number | null;
  opened_at: string;
  closed_at: string | null;
};

export type FocusSignals = {
  recentCount: number;
  topSymbols: { symbol: string; count: number }[];
  worstEmotion: { emotion: string; pnl: number; count: number } | null;
  bestStrategy: { id: string; name: string; pnl: number; count: number } | null;
  afterLoss: { count: number; pnl: number } | null;
  outsideFocus: { count: number; pnl: number; symbols: string[] } | null;
  noStop: number;
};

const DAY = 86_400_000;

export function deriveSignals(
  trades: SignalTrade[],
  strategies: { id: string; name: string }[],
  focus: FocusProfile,
  now = new Date(),
): FocusSignals {
  const since = now.getTime() - 30 * DAY;
  const recent = trades.filter((t) => new Date(t.opened_at).getTime() >= since);
  const closed = recent.filter((t) => t.status === "closed" && t.pnl != null);

  const bySym = new Map<string, number>();
  for (const t of recent)
    bySym.set(normSymbol(t.symbol), (bySym.get(normSymbol(t.symbol)) ?? 0) + 1);
  const topSymbols = [...bySym]
    .map(([symbol, count]) => ({ symbol, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);

  const group = <K extends string>(key: (t: SignalTrade) => K | null) => {
    const m = new Map<K, { pnl: number; count: number }>();
    for (const t of closed) {
      const k = key(t);
      if (!k) continue;
      const g = m.get(k) ?? { pnl: 0, count: 0 };
      g.pnl += t.pnl ?? 0;
      g.count++;
      m.set(k, g);
    }
    return [...m];
  };

  const emo = group((t) => t.emotion)
    .filter(([, g]) => g.count >= 2 && g.pnl < 0)
    .sort((a, b) => a[1].pnl - b[1].pnl)[0];
  const strat = group((t) => t.strategy_id)
    .filter(([, g]) => g.count >= 3 && g.pnl > 0)
    .sort((a, b) => b[1].pnl - a[1].pnl)[0];
  const stratName = strat ? strategies.find((s) => s.id === strat[0])?.name : undefined;

  // Trades opened within 60 minutes after a losing close: the revenge window.
  const losses = closed
    .filter((t) => (t.pnl ?? 0) < 0 && t.closed_at)
    .map((t) => new Date(t.closed_at!).getTime());
  const after = closed.filter((t) => {
    const o = new Date(t.opened_at).getTime();
    return losses.some((l) => o > l && o - l <= 60 * 60_000);
  });

  const outside = recent.filter((t) => inMarkets(t.symbol, focus.markets) === false);

  return {
    recentCount: recent.length,
    topSymbols,
    worstEmotion: emo ? { emotion: emo[0], ...emo[1] } : null,
    bestStrategy: strat && stratName ? { id: strat[0], name: stratName, ...strat[1] } : null,
    afterLoss:
      after.length >= 2
        ? { count: after.length, pnl: after.reduce((a, t) => a + (t.pnl ?? 0), 0) }
        : null,
    outsideFocus: outside.length
      ? {
          count: outside.length,
          pnl: outside.reduce((a, t) => a + (t.status === "closed" ? (t.pnl ?? 0) : 0), 0),
          symbols: [...new Set(outside.map((t) => normSymbol(t.symbol)))].slice(0, 3),
        }
      : null,
    noStop: recent.filter((t) => t.stop_loss == null || t.stop_loss === 0).length,
  };
}

export type Insight = { tone: "warning" | "success" | "info"; text: string };

/** The few sentences worth showing, most important first. */
export function buildInsights(
  s: FocusSignals,
  f: FocusProfile,
  money: (n: number) => string,
): Insight[] {
  const out: Insight[] = [];
  if (s.outsideFocus)
    out.push({
      tone: "warning",
      text: `${s.outsideFocus.count} صفقة برّا سوقك (${s.outsideFocus.symbols.join("، ")}) آخر 30 يوم${s.outsideFocus.pnl ? `، نتيجتها ${money(s.outsideFocus.pnl)}` : ""}.`,
    });
  if (s.afterLoss && s.afterLoss.pnl < 0)
    out.push({
      tone: "warning",
      text: `الصفقات خلال ساعة بعد خسارة: ${s.afterLoss.count} صفقة، نتيجتها ${money(s.afterLoss.pnl)}.`,
    });
  if (s.worstEmotion)
    out.push({
      tone: "warning",
      text: `لما تكون "${s.worstEmotion.emotion}" خسرت ${money(s.worstEmotion.pnl)} في ${s.worstEmotion.count} صفقات.`,
    });
  if (s.noStop > 0)
    out.push({ tone: "warning", text: `${s.noStop} صفقة بدون وقف خسارة آخر 30 يوم.` });
  if (s.bestStrategy)
    out.push({
      tone: "success",
      text: `أفضل استراتيجية: ${s.bestStrategy.name} (${money(s.bestStrategy.pnl)} في ${s.bestStrategy.count} صفقات).`,
    });
  if (f.markets.length === 0 && s.topSymbols[0])
    out.push({
      tone: "info",
      text: `أكتر سوق بتتداوله: ${s.topSymbols.map((x) => x.symbol).join("، ")}. ثبّته كسوقك لينبهك النظام إذا طلعت برّاه.`,
    });
  return out.slice(0, 4);
}

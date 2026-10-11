import { z } from "zod";

/**
 * Capital ledger: deposits, withdrawals and balance corrections, stored as one
 * hidden knowledge_notes row (no schema change). The live balance is
 *   starting_balance + P&L of trades closed since onboarding + deposits − withdrawals + corrections
 * so every closed loss or win moves it automatically. Pure: safe on client and server.
 */
export const CAPITAL_CATEGORY = "__capital";
export const CAPITAL_TITLE = "سجل رأس المال";
const MAX_ENTRIES = 1000;

const EntrySchema = z.object({
  id: z.string(),
  kind: z.enum(["deposit", "withdrawal", "adjust"]),
  amount: z.number().finite(),
  note: z.string().max(300).nullable().catch(null),
  at: z.string(),
});
export type CapitalEntry = z.infer<typeof EntrySchema>;
export type Ledger = { entries: CapitalEntry[] };

export function parseLedger(content: string | null | undefined): Ledger {
  if (!content) return { entries: [] };
  try {
    const raw = JSON.parse(content) as { entries?: unknown[] };
    const entries = (raw.entries ?? []).flatMap((e) => {
      const r = EntrySchema.safeParse(e);
      return r.success ? [r.data] : [];
    });
    return { entries };
  } catch {
    return { entries: [] };
  }
}

export type CapitalTrade = {
  status: string;
  pnl: number | null;
  opened_at: string;
  closed_at: string | null;
};

export type CapitalSummary = {
  starting: number;
  tradePnl: number;
  deposits: number;
  withdrawals: number;
  adjustments: number;
  balance: number;
  /** Money the trader put in, net of withdrawals. */
  netInvested: number;
  /** Balance minus netInvested: what trading actually made or lost. */
  growth: number;
  growthPct: number;
};

const round = (n: number) => Math.round(n * 100) / 100;

export function computeCapital(input: {
  starting: number;
  /** Trades closed before this (onboarding) are already inside starting_balance. */
  since: string | null;
  trades: CapitalTrade[];
  entries: CapitalEntry[];
}): CapitalSummary {
  const since = input.since ? Date.parse(input.since) : Number.NEGATIVE_INFINITY;
  const tradePnl = input.trades
    .filter(
      (t) =>
        t.status === "closed" && t.pnl != null && Date.parse(t.closed_at ?? t.opened_at) >= since,
    )
    .reduce((a, t) => a + (t.pnl ?? 0), 0);
  const sum = (k: CapitalEntry["kind"]) =>
    input.entries.filter((e) => e.kind === k).reduce((a, e) => a + e.amount, 0);
  const deposits = sum("deposit");
  const withdrawals = sum("withdrawal");
  const adjustments = sum("adjust");
  const starting = Number(input.starting) || 0;
  const balance = starting + tradePnl + deposits - withdrawals + adjustments;
  const netInvested = starting + deposits - withdrawals;
  const growth = balance - netInvested;
  return {
    starting: round(starting),
    tradePnl: round(tradePnl),
    deposits: round(deposits),
    withdrawals: round(withdrawals),
    adjustments: round(adjustments),
    balance: round(balance),
    netInvested: round(netInvested),
    growth: round(growth),
    growthPct: netInvested > 0 ? round((growth / netInvested) * 100) : 0,
  };
}

export type CapitalMove = {
  kind: "deposit" | "withdrawal" | "set_balance";
  amount: number;
  note?: string | null;
};

export const MOVE_LABEL: Record<CapitalEntry["kind"], string> = {
  deposit: "إيداع",
  withdrawal: "سحب",
  adjust: "تصحيح الرصيد",
};

/** Validates a move against the current balance and returns the new ledger. */
export function applyMove(
  ledger: Ledger,
  move: CapitalMove,
  currentBalance: number,
  now = new Date(),
  id = `${now.getTime()}-${Math.random().toString(36).slice(2, 8)}`,
): { ledger: Ledger; entry: CapitalEntry; balance: number } {
  const amount = Number(move.amount);
  if (!Number.isFinite(amount) || amount < 0 || (move.kind !== "set_balance" && amount === 0))
    throw new Error("المبلغ لازم يكون رقم أكبر من صفر.");
  if (ledger.entries.length >= MAX_ENTRIES) throw new Error("سجل رأس المال ممتلئ.");
  if (move.kind === "withdrawal" && amount > currentBalance + 0.005)
    throw new Error(`السحب (${round(amount)}) أكبر من رصيدك الحالي (${round(currentBalance)}).`);

  let entry: CapitalEntry;
  if (move.kind === "set_balance") {
    const diff = round(amount - currentBalance);
    if (Math.abs(diff) < 0.01) throw new Error("هذا هو رصيدك الحالي أصلًا.");
    entry = {
      id,
      kind: "adjust",
      amount: diff,
      note: move.note?.trim() || `الرصيد صار ${round(amount)}`,
      at: now.toISOString(),
    };
  } else {
    entry = {
      id,
      kind: move.kind,
      amount: round(amount),
      note: move.note?.trim() || null,
      at: now.toISOString(),
    };
  }
  const signed = entry.kind === "withdrawal" ? -entry.amount : entry.amount;
  return {
    ledger: { entries: [...ledger.entries, entry] },
    entry,
    balance: round(currentBalance + signed),
  };
}

export const removeEntry = (ledger: Ledger, id: string): Ledger => ({
  entries: ledger.entries.filter((e) => e.id !== id),
});

/** Short Arabic block for the AI prompt. */
export function capitalForPrompt(
  s: CapitalSummary,
  entries: CapitalEntry[],
  currency: string,
): string {
  const m = (n: number) => `${round(n)} ${currency}`;
  const last = entries
    .slice(-5)
    .map(
      (e) =>
        `${MOVE_LABEL[e.kind]} ${m(e.amount)} (${e.at.slice(0, 10)}${e.note ? `، ${e.note}` : ""})`,
    )
    .join(" | ");
  return `رأس المال: الرصيد الحالي ${m(s.balance)} = البداية ${m(s.starting)} + أرباح/خسائر الصفقات ${m(s.tradePnl)} + إيداعات ${m(s.deposits)} − سحوبات ${m(s.withdrawals)}${s.adjustments ? ` + تصحيحات ${m(s.adjustments)}` : ""}. نمو التداول: ${m(s.growth)} (${s.growthPct}%).${last ? ` آخر الحركات: ${last}` : ""}`;
}

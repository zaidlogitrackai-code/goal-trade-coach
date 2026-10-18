import { queryOptions, useQuery } from "@tanstack/react-query";
import { applyPctLimits, pctFromDollars } from "@/lib/effective-limits";
import { supabase } from "@/integrations/supabase/client";
import {
  applyMove,
  CAPITAL_CATEGORY,
  CAPITAL_TITLE,
  computeCapital,
  parseLedger,
  removeEntry,
  type CapitalMove,
  type CapitalSummary,
  type Ledger,
} from "@/lib/capital";
import {
  currentUserId,
  fetchClosedTrades,
  readCapitalRow,
  settingsQuery,
  tradesQuery,
} from "@/lib/queries";

/** Client-side read/write of the capital ledger (one hidden knowledge_notes row, read via readCapitalRow). */
export const capitalQuery = queryOptions({
  queryKey: ["capital"],
  queryFn: async (): Promise<Ledger> => parseLedger((await readCapitalRow())?.content),
});

async function writeLedger(rowId: string | null, ledger: Ledger) {
  const content = JSON.stringify(ledger);
  const { error } = rowId
    ? await supabase.from("knowledge_notes").update({ content }).eq("id", rowId)
    : await supabase
        .from("knowledge_notes")
        .insert({
          user_id: await currentUserId(),
          title: CAPITAL_TITLE,
          category: CAPITAL_CATEGORY,
          content,
        });
  if (error) throw new Error(error.message);
}

/** Fresh balance straight from the database (used before every move and by the AI trade gate). */
export async function loadCapital(): Promise<{
  rowId: string | null;
  ledger: Ledger;
  summary: CapitalSummary;
}> {
  const [row, settings, trades] = await Promise.all([
    readCapitalRow(),
    supabase.from("trading_settings").select("starting_balance,created_at").maybeSingle(),
    fetchClosedTrades(),
  ]);
  if (settings.error) throw new Error(settings.error.message);
  const ledger = parseLedger(row?.content);
  const summary = computeCapital({
    starting: Number(settings.data?.starting_balance) || 0,
    since: settings.data?.created_at ?? null,
    trades,
    entries: ledger.entries,
  });
  return { rowId: row?.id ?? null, ledger, summary };
}

export async function moveCapital(move: CapitalMove) {
  const { rowId, ledger, summary } = await loadCapital();
  // Already at that balance: nothing to change, not an error.
  if (move.kind === "set_balance" && Math.abs(Number(move.amount) - summary.balance) < 0.01) return { ledger, entry: null, balance: summary.balance };
  const next = applyMove(ledger, move, summary.balance);
  await writeLedger(rowId, next.ledger);
  return next;
}

export async function deleteCapitalEntry(id: string) {
  const { rowId, ledger } = await loadCapital();
  if (!rowId) return;
  await writeLedger(rowId, removeEntry(ledger, id));
}

/** Live capital summary from cached queries; null while loading. */
export function useCapital(): { summary: CapitalSummary; ledger: Ledger } | null {
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const c = useQuery(capitalQuery);
  if (!s.data || !t.data || !c.data) return null;
  return {
    ledger: c.data,
    summary: computeCapital({
      starting: Number(s.data.starting_balance) || 0,
      since: s.data.created_at,
      trades: t.data,
      entries: c.data.entries,
    }),
  };
}

/** After dollar limits change, remember them as % of the current balance so they scale with it. */
export async function syncLimitsPct(patch: Record<string, unknown>) {
  const { summary } = await loadCapital();
  const { data } = await supabase.from("trading_settings").select("user_id,limits_pct").maybeSingle();
  if (!data) return;
  const pct = pctFromDollars(patch, summary.balance, data.limits_pct);
  if (pct) await supabase.from("trading_settings").update({ limits_pct: pct }).eq("user_id", data.user_id);
}

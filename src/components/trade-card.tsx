import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { Eye, ShieldAlert, ShieldCheck } from "lucide-react";
import { cardHref, cardSizing, parseTradeCard, type TradeCard } from "@/lib/trade-card";
import { breakerCopy, evaluateBreaker, type BreakerCopy } from "@/lib/circuit-breaker";
import { fmtMoney, settingsQuery, todayPlanQuery, tradesQuery } from "@/lib/queries";
import { useCapital } from "@/lib/capital-store";
import { Button } from "@/components/ui/button";

const STYLE_LABEL = { scalp: "سكالب", intraday: "داخل اليوم", swing: "سوينق" } as const;
const f = (n: number | null) => (n == null ? "—" : String(n));

function Row({ label, value, tone }: { label: string; value: React.ReactNode; tone: "success" | "destructive" | "muted" }) {
  const c = tone === "success" ? "border-success/40 bg-success/10 text-success" : tone === "destructive" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-muted/40 text-foreground";
  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg border px-3 py-2 ${c}`}>
      <span className="text-xs font-medium">{label}</span>
      <span className="font-display text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

const Num = ({ children }: { children: React.ReactNode }) => <bdi dir="ltr">{children}</bdi>;

/** Today's breaker and his per-trade risk, on the same rows the stepper reads (no latching yet). */
function useGateNow(): { copy: BreakerCopy; halted: boolean; maxRisk: number; currency: string } | null {
  const s = useQuery(settingsQuery);
  const t = useQuery(tradesQuery);
  const plan = useQuery({ ...todayPlanQuery(s.data?.timezone), enabled: !!s.data });
  const capital = useCapital();
  const st = s.data;
  if (!st || !t.data) return null;
  const r = evaluateBreaker({
    settings: st,
    startBalance: plan.data?.start_balance ?? null,
    balance: capital?.summary.balance ?? st.current_balance,
    trades: t.data,
    planMaxLoss: plan.data?.max_loss ?? null,
    limitsAcceptedAt: st.limits_accepted_at,
    breakerSince: st.breaker_since,
    pausedUntil: st.paused_until,
    tz: st.timezone,
  });
  const maxRisk = Math.min(...[Number(st.max_risk_per_trade) || 0, Number(plan.data?.risk_per_trade) || 0].filter((x) => x > 0));
  return { copy: breakerCopy(r, st.currency), halted: r.state !== "TRADING_ALLOWED", maxRisk: Number.isFinite(maxRisk) ? maxRisk : 0, currency: st.currency };
}

function GateBanner({ copy }: { copy: BreakerCopy }) {
  const c = copy.tone === "destructive" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-warning/40 bg-warning/10 text-warning";
  return (
    <div role="status" className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-xs ${c}`}>
      <ShieldAlert className="mt-0.5 size-4 shrink-0" />
      <span><b>{copy.chip}</b> — {copy.reason}{copy.release && <> · {copy.release}</>}</span>
    </div>
  );
}

function Actions({ card, analysisId }: { card: TradeCard; analysisId?: string | null | undefined }) {
  const navigate = useNavigate();
  const gate = useGateNow();
  const size = gate ? cardSizing(card, gate.maxRisk) : null;
  return (
    <>
      {gate?.halted && <GateBanner copy={gate.copy} />}
      {size && (
        <Row
          label="الحجم على حد مخاطرتك"
          value={size.lots > 0 ? <><Num>{size.lots}</Num> لوت · <Num>{fmtMoney(size.risk, gate!.currency)}</Num></> : "الوقف أبعد من حدك"}
          tone={size.lots > 0 ? "muted" : "destructive"}
        />
      )}
      {/* The gate stepper decides; this only hands it the card's numbers. */}
      <Button className="h-11 w-full gap-2" variant={gate?.halted ? "secondary" : "default"} onClick={() => void navigate({ href: cardHref(card, analysisId) })}>
        <ShieldCheck className="size-4" /> مرّرها على البوابة
      </Button>
    </>
  );
}

export function TradeCardView({ raw, analysisId }: { raw: string; analysisId?: string | null }) {
  const p = parseTradeCard(raw);
  if (!p.ok) return <div className="mt-3 rounded-lg border border-warning/40 bg-warning/10 p-3 text-xs text-warning">{p.error} — اطلب تحليل جديد.</div>;
  const c = p.card;
  if (c.direction === "none") {
    return (
      <div className="mt-3 rounded-xl border border-border bg-muted/40 p-3">
        <p className="text-sm font-semibold">لا صفقة — انتظر</p>
        {c.no_trade_reason && <p className="mt-1 text-xs text-muted-foreground">{c.no_trade_reason}</p>}
      </div>
    );
  }
  const buy = c.direction === "buy";
  const entry = c.entry_from === c.entry_to ? f(c.entry_from) : `${f(c.entry_from)} – ${f(c.entry_to)}`;
  const meta = [c.symbol, c.timeframe, c.strategy].filter(Boolean);
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5">
          <span className={`rounded-full px-3 py-1 text-xs font-bold ${buy ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>{buy ? "شراء" : "بيع"}</span>
          {c.intent === "watch" && <span className="flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold"><Eye className="size-3.5" /> راقبها</span>}
        </span>
        <span className="text-xs text-muted-foreground">
          {c.rr != null && <>العائد/المخاطرة <b dir="ltr" className="text-foreground">1:{c.rr}</b></>}
          {c.confidence && <> · الثقة {c.confidence}</>}
        </span>
      </div>
      {meta.length > 0 && <p className="text-xs text-muted-foreground">{meta.map((m, i) => <span key={i}>{i > 0 && " · "}<Num>{m}</Num></span>)}</p>}
      {(c.style || c.hold) && (
        <Row label="نوع الصفقة / المدة" value={[c.style ? STYLE_LABEL[c.style] : null, c.hold].filter(Boolean).join(" · ")} tone="muted" />
      )}
      <Row label="الدخول" value={<Num>{entry}</Num>} tone="muted" />
      <div className="grid grid-cols-2 gap-2">
        <Row label="TP1" value={<Num>{f(c.tp1)}</Num>} tone="success" />
        <Row label="TP2" value={<Num>{f(c.tp2)}</Num>} tone="success" />
      </div>
      <Row label="SL" value={<Num>{f(c.sl)}</Num>} tone="destructive" />
      {c.skills.length > 0 && <p className="text-[11px] text-muted-foreground">اتفقت: {c.skills.join(" + ")}</p>}
      {c.gate && <p className="text-[11px] text-muted-foreground">البوابة: {c.gate}</p>}
      {c.intent === "trade" && <Actions card={c} analysisId={analysisId} />}
    </div>
  );
}

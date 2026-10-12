import { parseTradeCard } from "@/lib/trade-card";

const STYLE_LABEL = { scalp: "سكالب", intraday: "داخل اليوم", swing: "سوينق" } as const;
const f = (n: number | null) => (n == null ? "—" : String(n));

function Row({ label, value, tone }: { label: string; value: string; tone: "success" | "destructive" | "muted" }) {
  const c = tone === "success" ? "border-success/40 bg-success/10 text-success" : tone === "destructive" ? "border-destructive/40 bg-destructive/10 text-destructive" : "border-border bg-muted/40 text-foreground";
  return (
    <div className={`flex items-center justify-between rounded-lg border px-3 py-2 ${c}`}>
      <span className="text-xs font-medium">{label}</span>
      <span dir="ltr" className="font-display text-sm font-semibold tabular-nums">{value}</span>
    </div>
  );
}

export function TradeCardView({ raw }: { raw: string }) {
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
  return (
    <div className="mt-3 space-y-2 rounded-xl border border-border p-3">
      <div className="flex items-center justify-between gap-2">
        <span className={`rounded-full px-3 py-1 text-xs font-bold ${buy ? "bg-success/15 text-success" : "bg-destructive/15 text-destructive"}`}>{buy ? "شراء" : "بيع"}</span>
        <span className="text-xs text-muted-foreground">
          {c.rr != null && <>العائد/المخاطرة <b dir="ltr" className="text-foreground">1:{c.rr}</b></>}
          {c.confidence && <> · الثقة {c.confidence}</>}
        </span>
      </div>
      {(c.style || c.hold) && (
        <Row label="نوع الصفقة / المدة" value={[c.style ? STYLE_LABEL[c.style] : null, c.hold].filter(Boolean).join(" · ")} tone="muted" />
      )}
      <Row label="الدخول" value={entry} tone="muted" />
      <div className="grid grid-cols-2 gap-2">
        <Row label="TP1" value={f(c.tp1)} tone="success" />
        <Row label="TP2" value={f(c.tp2)} tone="success" />
      </div>
      <Row label="SL" value={f(c.sl)} tone="destructive" />
      {c.skills.length > 0 && <p className="text-[11px] text-muted-foreground">اتفقت: {c.skills.join(" + ")}</p>}
    </div>
  );
}

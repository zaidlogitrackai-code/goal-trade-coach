import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis, ReferenceArea } from "recharts";
import { ArrowDownRight, ArrowUpRight, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Md } from "@/components/md";
import { performanceInsight } from "@/lib/ai.functions";
import { fmtMoney, type Trade } from "@/lib/queries";
import { dayKey } from "@/lib/perf";

export const tip = { contentStyle: { background: "var(--popover)", border: "1px solid var(--border)", borderRadius: 12, color: "var(--foreground)" } };

export function Kpi({ label, value, sub, delta, tone, spark }: { label: string; value: string; sub?: string | undefined; delta?: number | null | undefined; tone?: "success" | "destructive" | undefined; spark?: number[] | undefined }) {
  const c = tone === "success" ? "text-success" : tone === "destructive" ? "text-destructive" : "text-foreground";
  return (
    <div className="panel flex flex-col gap-1 p-4">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className={`font-data text-2xl font-bold tabular-nums lg:text-3xl ${c}`} dir="ltr">{value}</span>
      <div className="flex min-h-5 items-center justify-between gap-2 text-xs text-muted-foreground">
        <span>{sub}</span>
        {delta != null && Number.isFinite(delta) && (
          <span className={`inline-flex items-center gap-0.5 ${delta >= 0 ? "text-success" : "text-destructive"}`} dir="ltr">
            {delta >= 0 ? <ArrowUpRight className="size-3" /> : <ArrowDownRight className="size-3" />}{Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </div>
      {spark && spark.length > 1 && <Spark data={spark} />}
    </div>
  );
}

function Spark({ data }: { data: number[] }) {
  const min = Math.min(...data), max = Math.max(...data), r = max - min || 1;
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * 100},${20 - ((v - min) / r) * 18}`).join(" ");
  const up = data[data.length - 1]! >= data[0]!;
  return <svg viewBox="0 0 100 22" className={`mt-1 h-6 w-full ${up ? "text-success" : "text-destructive"}`} preserveAspectRatio="none"><polyline points={pts} fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" /></svg>;
}

export function EquityChart({ curve, dd }: { curve: { n: number; balance: number }[]; dd: { amount: number; pct: number }; cur: string }) {
  let peak = -Infinity, ddFrom = 0, ddTo = 0, best = 0, peakN = 0;
  for (const p of curve) { if (p.balance > peak) { peak = p.balance; peakN = p.n; } if (peak - p.balance > best) { best = peak - p.balance; ddFrom = peakN; ddTo = p.n; } }
  return (
    <div className="panel p-4 sm:p-5">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h2 className="font-semibold">منحنى الرصيد</h2>
        <span className="text-xs text-muted-foreground">أعمق نزول: <span className="font-data text-destructive" dir="ltr">-{dd.pct.toFixed(1)}%</span></span>
      </div>
      {curve.length < 2 ? <p className="py-10 text-center text-sm text-muted-foreground">يطلع المنحنى بعد صفقتين مسكّرتين.</p> : (
        <div className="h-64" dir="ltr">
          <ResponsiveContainer>
            <AreaChart data={curve}>
              <defs><linearGradient id="eq" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="var(--chart-1)" stopOpacity={0.35} /><stop offset="1" stopColor="var(--chart-1)" stopOpacity={0} /></linearGradient></defs>
              <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="n" stroke="var(--muted-foreground)" fontSize={11} />
              <YAxis stroke="var(--muted-foreground)" fontSize={11} domain={["auto", "auto"]} width={50} />
              <Tooltip {...tip} />
              {best > 0 && <ReferenceArea x1={ddFrom} x2={ddTo} fill="var(--destructive)" fillOpacity={0.08} />}
              <Area type="monotone" dataKey="balance" name="الرصيد" stroke="var(--chart-1)" strokeWidth={2} fill="url(#eq)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
}

export function Goals({ rows, cur }: { rows: { label: string; pnl: number; target: number; loss: number }[]; cur: string }) {
  return (
    <div className="panel space-y-4 p-4 sm:p-5">
      <h2 className="font-semibold">التقدم نحو أهدافك</h2>
      {rows.map((r) => {
        const has = r.target > 0 || r.loss > 0;
        const pct = r.pnl >= 0 ? (r.target > 0 ? Math.min(100, (r.pnl / r.target) * 100) : 0) : (r.loss > 0 ? Math.min(100, (-r.pnl / r.loss) * 100) : 0);
        return (
          <div key={r.label} className="space-y-1.5">
            <div className="flex justify-between text-sm"><span>{r.label}</span><span className={`font-data ${r.pnl >= 0 ? "text-success" : "text-destructive"}`} dir="ltr">{fmtMoney(r.pnl, cur)}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full transition-all ${r.pnl >= 0 ? "bg-success" : "bg-destructive"}`} style={{ width: `${pct}%` }} /></div>
            <div className="flex justify-between text-xs text-muted-foreground">
              {has ? <><span>الهدف {r.target > 0 ? fmtMoney(r.target, cur) : "—"}</span><span>حد الخسارة {r.loss > 0 ? fmtMoney(r.loss, cur) : "—"}</span></> : <span>ما حددت هدف لهذي الفترة — قل للمدرب.</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function PnlCalendar({ days, trades, tz, cur }: { days: Map<string, { day: string; pnl: number; count: number }>; trades: Trade[]; tz: string; cur: string }) {
  const [sel, setSel] = useState<string | null>(null);
  const today = new Date();
  const cells: string[] = [];
  for (let i = 69; i >= 0; i--) cells.push(dayKey(new Date(today.getTime() - i * 86_400_000), tz));
  const max = Math.max(1, ...[...days.values()].map((d) => Math.abs(d.pnl)));
  const picked = sel ? trades.filter((t) => t.status === "closed" && dayKey(new Date(t.closed_at ?? t.opened_at), tz) === sel) : [];
  return (
    <div className="panel p-4 sm:p-5">
      <h2 className="mb-3 font-semibold">تقويم الأيام <span className="text-xs font-normal text-muted-foreground">(آخر ١٠ أسابيع)</span></h2>
      <div className="overflow-x-auto pb-1">
        <div className="grid w-max grid-flow-col grid-rows-7 gap-1" dir="ltr">
          {cells.map((k) => {
            const d = days.get(k);
            const a = d ? 0.25 + 0.75 * (Math.abs(d.pnl) / max) : 0;
            const bg = !d ? "var(--muted)" : `color-mix(in oklab, var(${d.pnl >= 0 ? "--success" : "--destructive"}) ${Math.round(a * 100)}%, transparent)`;
            return <button key={k} type="button" onClick={() => setSel(sel === k ? null : k)} title={d ? `${k}: ${fmtMoney(d.pnl, cur)} (${d.count})` : k} className={`size-4 rounded-[4px] sm:size-5 ${sel === k ? "ring-2 ring-foreground" : ""}`} style={{ background: bg }} />;
          })}
        </div>
      </div>
      {sel && (
        <div className="mt-3 space-y-1 border-t border-border/50 pt-3 text-sm">
          <div className="text-xs text-muted-foreground" dir="ltr">{sel}</div>
          {picked.length === 0 ? <p className="text-muted-foreground">ما في صفقات مسكّرة هذا اليوم.</p> : picked.map((t) => (
            <div key={t.id} className="flex justify-between"><span>{t.symbol} · {t.direction === "buy" ? "شراء" : "بيع"}</span><span className={`font-data ${(Number(t.pnl) || 0) >= 0 ? "text-success" : "text-destructive"}`} dir="ltr">{fmtMoney(Number(t.pnl) || 0, cur)}</span></div>
          ))}
        </div>
      )}
    </div>
  );
}

export function Breakdown({ title, data, cur }: { title: string; data: { name: string; pnl: number; count: number; wins: number }[]; cur: string }) {
  const max = Math.max(1, ...data.map((d) => Math.abs(d.pnl)));
  return (
    <div className="panel p-4 sm:p-5">
      <h2 className="mb-3 font-semibold">{title}</h2>
      {data.length === 0 ? <p className="text-sm text-muted-foreground">—</p> : (
        <div className="space-y-2.5">
          {data.map((g) => (
            <div key={g.name} className="space-y-1">
              <div className="flex justify-between gap-2 text-sm"><span className="truncate">{g.name} <span className="text-xs text-muted-foreground">({g.count} · فوز {Math.round((g.wins / g.count) * 100)}%)</span></span><span className={`font-data shrink-0 ${g.pnl >= 0 ? "text-success" : "text-destructive"}`} dir="ltr">{fmtMoney(g.pnl, cur)}</span></div>
              <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={`h-full rounded-full ${g.pnl >= 0 ? "bg-success" : "bg-destructive"}`} style={{ width: `${(Math.abs(g.pnl) / max) * 100}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function CoachInsight({ period, stats, disabled }: { period: string; stats: string; disabled: boolean }) {
  const fn = useServerFn(performanceInsight);
  const m = useMutation({ mutationFn: () => fn({ data: { period, stats } }) });
  return (
    <div className="panel p-4 sm:p-5">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="font-semibold">ملاحظة المدرب</h2>
        <Button size="sm" variant="outline" disabled={disabled || m.isPending} onClick={() => m.mutate()}><RefreshCw className={`size-3.5 ${m.isPending ? "animate-spin" : ""}`} />{m.data ? "حدّث" : "حلّل أدائي"}</Button>
      </div>
      {m.isError ? <p className="text-sm text-destructive">ما قدرت أحلل الحين، جرّب بعد شوي.</p>
        : m.data?.text ? <div className="text-sm"><Md>{m.data.text}</Md></div>
        : <p className="text-sm text-muted-foreground">{disabled ? "تطلع الملاحظة بعد أول صفقة مسكّرة." : "اضغط عشان المدرب يقرأ أرقامك ويقول لك وين تربح ووين تخسر."}</p>}
    </div>
  );
}

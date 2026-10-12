import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { getQuotes } from "@/lib/market.functions";

export function LiveTicker() {
  const fn = useServerFn(getQuotes);
  const { data } = useQuery({ queryKey: ["live-quotes"], queryFn: () => fn(), refetchInterval: 30_000, staleTime: 25_000 });
  if (!data) return <div className="mb-2 h-9 shrink-0" />;
  return (
    <div dir="ltr" className="mb-2 flex shrink-0 gap-2 overflow-x-auto pb-1 text-xs [scrollbar-width:none]">
      {data.map((q) => (
        <div key={q.key} className="glass shrink-0 rounded-full px-3 py-1.5 tabular-nums">
          <span className="font-semibold">{q.key}</span>{" "}
          <span>{q.price == null ? "—" : q.price.toFixed(q.digits)}</span>{" "}
          {q.changePct != null && <span className={q.changePct >= 0 ? "text-emerald-500" : "text-red-500"}>{q.changePct >= 0 ? "+" : ""}{q.changePct.toFixed(2)}%</span>}
        </div>
      ))}
    </div>
  );
}

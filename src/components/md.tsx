import { memo, useMemo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import { splitTradeBlock } from "@/lib/trade-card";
import { splitTables, type CellAlign, type MdBlock } from "@/lib/md-tables";
import { TradeCardView } from "@/components/trade-card";

// Table cells are inline: no <p> margins inside a cell.
const INLINE: Components = { p: ({ children }) => <>{children}</> };
const ALIGN: Record<NonNullable<CellAlign>, string> = { start: "text-start", center: "text-center", end: "text-end" };

function Cell({ text, align, head }: { text: string; align: CellAlign; head?: boolean }): ReactNode {
  const cls = `border-b border-border/60 px-3 py-2 align-top ${align ? ALIGN[align] : "text-start"}`;
  const body = <ReactMarkdown components={INLINE}>{text}</ReactMarkdown>;
  return head ? <th className={`${cls} font-semibold`}>{body}</th> : <td className={cls}>{body}</td>;
}

/** A wide watchlist table scrolls sideways inside the bubble instead of widening the page. */
function Table({ t }: { t: Extract<MdBlock, { kind: "table" }> }) {
  return (
    <div className="-mx-1 max-w-full overflow-x-auto overscroll-x-contain rounded-xl border border-border/60">
      <table className="w-full min-w-max border-collapse text-sm leading-6">
        <thead className="bg-muted/40">
          <tr>{t.head.map((h, i) => <Cell key={i} text={h} align={t.align[i] ?? null} head />)}</tr>
        </thead>
        <tbody>
          {t.rows.map((r, ri) => (
            <tr key={ri} className="[&:last-child>td]:border-b-0">
              {r.map((c, ci) => <Cell key={ci} text={c} align={t.align[ci] ?? null} />)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Assistant text. On the phone it reads at 16px with 1.75 leading: Arabic harakat sit above
 * and below the letters and get clipped (or touch the next line) at the old 14px/1.5.
 * Memoized: typing in the composer must not re-parse every reply in the thread.
 */
export const Md = memo(function Md({ children }: { children: string }) {
  const { blocks, raw } = useMemo(() => {
    const { body, raw } = splitTradeBlock(children);
    return { blocks: splitTables(body), raw };
  }, [children]);
  return (
    <>
    <div className="bidi-paragraphs space-y-2 text-base leading-[1.75] md:text-sm md:leading-6 lg:leading-7 [&_h1]:text-[17px] [&_h1]:font-semibold md:[&_h1]:text-base [&_h2]:text-base [&_h2]:font-semibold md:[&_h2]:text-[15px] [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:ms-5 [&_ol]:list-decimal [&_ol]:space-y-1 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1">
      {blocks.map((b, i) => (b.kind === "table" ? <Table key={i} t={b} /> : <ReactMarkdown key={i}>{b.text}</ReactMarkdown>))}
    </div>
    {raw && <TradeCardView raw={raw} />}
    </>
  );
});

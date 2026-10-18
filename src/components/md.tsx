import ReactMarkdown from "react-markdown";
import { splitTradeBlock } from "@/lib/trade-card";
import { TradeCardView } from "@/components/trade-card";

/**
 * Assistant text. On the phone it reads at 16px with 1.75 leading: Arabic harakat sit above
 * and below the letters and get clipped (or touch the next line) at the old 14px/1.5.
 */
export function Md({ children }: { children: string }) {
  const { body, raw } = splitTradeBlock(children);
  return (
    <>
    <div className="space-y-2 text-base leading-[1.75] md:text-sm md:leading-6 lg:leading-7 [&_h1]:text-[17px] [&_h1]:font-semibold md:[&_h1]:text-base [&_h2]:text-base [&_h2]:font-semibold md:[&_h2]:text-[15px] [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:mr-5 [&_li]:pl-0 [&_ol]:list-decimal [&_ol]:space-y-1 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1">
      <ReactMarkdown>{body}</ReactMarkdown>
    </div>
    {raw && <TradeCardView raw={raw} />}
    </>
  );
}

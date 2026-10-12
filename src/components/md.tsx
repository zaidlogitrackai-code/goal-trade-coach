import ReactMarkdown from "react-markdown";
import { splitTradeBlock } from "@/lib/trade-card";
import { TradeCardView } from "@/components/trade-card";

export function Md({ children }: { children: string }) {
  const { body, raw } = splitTradeBlock(children);
  return (
    <>
    <div className="space-y-2 text-sm leading-6 lg:leading-7 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:mr-5 [&_li]:pl-0 [&_ol]:list-decimal [&_ol]:space-y-1 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1">
      <ReactMarkdown>{body}</ReactMarkdown>
    </div>
    {raw && <TradeCardView raw={raw} />}
    </>
  );
}

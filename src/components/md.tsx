import ReactMarkdown from "react-markdown";

export function Md({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm leading-6 lg:leading-7 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:text-[15px] [&_h2]:font-semibold [&_h3]:mt-2 [&_h3]:font-semibold [&_li]:mr-5 [&_li]:pl-0 [&_ol]:list-decimal [&_ol]:space-y-1 [&_strong]:text-foreground [&_ul]:list-disc [&_ul]:space-y-1">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}

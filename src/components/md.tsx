import ReactMarkdown from "react-markdown";

export function Md({ children }: { children: string }) {
  return (
    <div className="space-y-2 text-sm leading-7 [&_h1]:text-base [&_h1]:font-semibold [&_h2]:font-semibold [&_h3]:mt-3 [&_h3]:font-semibold [&_li]:mr-5 [&_ol]:list-decimal [&_strong]:text-foreground [&_ul]:list-disc">
      <ReactMarkdown>{children}</ReactMarkdown>
    </div>
  );
}

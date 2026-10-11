import { PageHeader } from "@/components/app-shell";

export function ComingSoon({ title, description, items }: { title: string; description: string; items: string[] }) {
  return (
    <div className="mx-auto max-w-3xl">
      <PageHeader title={title} />
      <div className="panel glow-primary p-8">
        <span className="bg-brand-gradient inline-block rounded-full px-3 py-1 text-xs font-medium text-primary-foreground">قريباً</span>
        <p className="mt-4 text-lg">{description}</p>
        <ul className="mt-6 space-y-2 text-sm text-muted-foreground">
          {items.map((i) => (
            <li key={i} className="flex items-center gap-2"><span className="size-1.5 rounded-full bg-primary" />{i}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

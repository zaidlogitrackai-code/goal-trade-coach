import { Link } from "@tanstack/react-router";
import { History, Play, CheckCircle2, AlertOctagon, TrendingUp, TrendingDown, ArrowUpRight } from "lucide-react";
import { Item, ItemGroup, ItemMedia, ItemContent, ItemTitle, ItemDescription, ItemActions } from "@/components/ui/item";
import { fmtDate, fmtMoney } from "@/lib/queries";

export interface ActivityFeedItem {
  id: string;
  type: "session_start" | "trade_open" | "trade_close" | "violation" | "cooldown";
  title: string;
  description: string;
  timestamp: string;
  link?: string;
  amount?: number | null;
  currency?: string;
}

interface ActivityListProps {
  items: ActivityFeedItem[];
}

export function ActivityList({ items }: ActivityListProps) {
  if (items.length === 0) {
    return (
      <div className="panel p-6 text-center space-y-2">
        <History className="size-8 mx-auto text-muted-foreground/50" />
        <h3 className="font-semibold text-sm">لا يوجد نشاط مسجل حديثاً</h3>
        <p className="text-xs text-muted-foreground">عندما تبدأ جلسة أو تسجل صفقة، ستظهر آخر 5 أحداث هنا.</p>
      </div>
    );
  }

  const getIcon = (type: ActivityFeedItem["type"], amount?: number | null) => {
    switch (type) {
      case "session_start":
        return <Play className="size-4 text-primary" />;
      case "trade_close":
        return amount != null && amount >= 0 ? (
          <TrendingUp className="size-4 text-success" />
        ) : (
          <TrendingDown className="size-4 text-destructive" />
        );
      case "trade_open":
        return <CheckCircle2 className="size-4 text-primary" />;
      case "violation":
        return <AlertOctagon className="size-4 text-destructive" />;
      case "cooldown":
        return <AlertOctagon className="size-4 text-warning" />;
    }
  };

  return (
    <div className="panel space-y-4 p-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">آخر النشاطات</h2>
          <p className="text-xs text-muted-foreground">أحدث 5 أحداث في رحلتك اليومية</p>
        </div>
        <Link to="/trades" className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
          <span>سجل الصفقات</span>
          <ArrowUpRight className="size-3.5" />
        </Link>
      </div>

      <ItemGroup className="divide-y divide-border/40">
        {items.slice(0, 5).map((item) => (
          <Item key={item.id} className="py-3 px-1 transition-colors hover:bg-muted/30 rounded-lg">
            <ItemMedia variant="icon" className="shrink-0">
              {getIcon(item.type, item.amount)}
            </ItemMedia>
            <ItemContent>
              <ItemTitle className="text-sm font-semibold flex items-center justify-between w-full">
                <span>{item.title}</span>
                {item.amount != null && item.currency && (
                  <span
                    dir="ltr"
                    className={`font-data text-xs font-bold ${
                      item.amount >= 0 ? "text-success" : "text-destructive"
                    }`}
                  >
                    {fmtMoney(item.amount, item.currency)}
                  </span>
                )}
              </ItemTitle>
              <ItemDescription className="text-xs text-muted-foreground">
                {item.description} · {fmtDate(item.timestamp)}
              </ItemDescription>
            </ItemContent>
            {item.link && (
              <ItemActions>
                <Link
                  to={item.link}
                  className="text-xs text-muted-foreground hover:text-primary transition-colors p-1"
                  aria-label="عرض التفاصيل"
                >
                  <ArrowUpRight className="size-4" />
                </Link>
              </ItemActions>
            )}
          </Item>
        ))}
      </ItemGroup>
    </div>
  );
}

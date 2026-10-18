import { useSyncExternalStore } from "react";
import { Toaster as Sonner } from "sonner";
import { currentTheme, subscribeTheme } from "@/lib/theme";

type ToasterProps = React.ComponentProps<typeof Sonner>;

// Just under the 4rem mobile header, so a toast never covers the clock, the island or the bell.
const BELOW_HEADER = { top: "calc(env(safe-area-inset-top) + 4.5rem)" };

const Toaster = ({ ...props }: ToasterProps) => {
  // Follows the html class (settings or the iPhone's automatic switch), not Sonner's own guess.
  const theme = useSyncExternalStore(subscribeTheme, currentTheme, () => "dark" as const);
  return (
    <Sonner
      theme={theme}
      dir="rtl"
      visibleToasts={2}
      offset={BELOW_HEADER}
      mobileOffset={BELOW_HEADER}
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            "group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg",
          description: "group-[.toast]:text-muted-foreground",
          actionButton: "group-[.toast]:bg-primary group-[.toast]:text-primary-foreground",
          cancelButton: "group-[.toast]:bg-muted group-[.toast]:text-muted-foreground",
        },
      }}
      {...props}
    />
  );
};

export { Toaster };

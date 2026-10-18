import { useState, type FormEvent, type KeyboardEvent, type ReactNode } from "react";
import { X } from "lucide-react";
import { PHONE_QUERY, useMediaQuery } from "@/hooks/use-media-query";
import {
  Drawer, DrawerClose, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle, DrawerTrigger,
} from "@/components/ui/drawer";
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";

export interface ResponsiveSheetProps {
  /** Rendered as the opening button (asChild). Leave out to drive it with `open`. */
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /**
   * Makes the body a <form>: the submit button and the keyboard's Go share one path, and
   * `onKeyDown` can stop Return from saving half-typed fields (form-keys.ts).
   */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
  onKeyDown?: (e: KeyboardEvent<HTMLFormElement>) => void;
  className?: string;
  children: ReactNode;
}

/**
 * One sheet for the whole app: a native-feeling drawer you can swipe down on the phone, a
 * centred dialog from 768px up. The open state lives here, so turning an iPad mid-way
 * swaps the shell without closing what he was typing in.
 */
export function ResponsiveSheet({ trigger, open, onOpenChange, title, description, onSubmit, onKeyDown, className, children }: ResponsiveSheetProps) {
  const phone = useMediaQuery(PHONE_QUERY);
  const [inner, setInner] = useState(false);
  const isOpen = open ?? inner;
  function setOpen(next: boolean) {
    if (open === undefined) setInner(next);
    onOpenChange?.(next);
  }

  const body = onSubmit ? (
    <form noValidate onSubmit={(e) => { e.preventDefault(); onSubmit(e); }} {...(onKeyDown ? { onKeyDown } : {})} className={className}>
      {children}
    </form>
  ) : (
    <div className={className}>{children}</div>
  );
  const noDescription = description ? {} : { "aria-describedby": undefined };

  if (phone) {
    return (
      <Drawer open={isOpen} onOpenChange={setOpen} shouldScaleBackground={false}>
        {trigger && <DrawerTrigger asChild>{trigger}</DrawerTrigger>}
        <DrawerContent
          dir="rtl"
          className="max-h-[calc(var(--vvh,100dvh)_-_env(safe-area-inset-top)_-_0.5rem)] outline-none"
          {...noDescription}
        >
          <DrawerHeader className="grid-cols-[minmax(0,1fr)_auto] items-start gap-x-2 px-5 pb-2 pt-3 text-start">
            <div className="min-w-0 space-y-1">
              <DrawerTitle className="leading-normal tracking-normal">{title}</DrawerTitle>
              {description && <DrawerDescription>{description}</DrawerDescription>}
            </div>
            <DrawerClose className="-me-2 -mt-1 grid size-11 place-items-center rounded-full text-muted-foreground active:bg-accent">
              <X className="size-5" />
              <span className="sr-only">إغلاق</span>
            </DrawerClose>
          </DrawerHeader>
          {/* Scrolls on its own above the home indicator; vaul only drags from the top. */}
          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))]">
            {body}
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={setOpen}>
      {trigger && <DialogTrigger asChild>{trigger}</DialogTrigger>}
      <DialogContent dir="rtl" className="max-h-[85dvh] overflow-y-auto" {...noDescription}>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {body}
      </DialogContent>
    </Dialog>
  );
}

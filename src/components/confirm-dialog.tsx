import type { ReactNode } from "react";
import { buttonVariants } from "@/components/ui/button";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription,
  AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

/**
 * The app's one "are you sure?" sheet, in place of window.confirm/prompt: those show the
 * site's address in English on the iPhone and a stray tap on OK can't be taken back.
 * Pass `trigger` for a button that opens it, or `open`/`onOpenChange` to drive it.
 */
export function ConfirmDialog({
  trigger, open, onOpenChange, title, description, children,
  confirmLabel, cancelLabel = "إلغاء", destructive = false, confirmDisabled = false, onConfirm,
}: {
  trigger?: ReactNode;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  /** Extra fields (an optional note, a typed confirmation) between the text and the buttons. */
  children?: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  destructive?: boolean;
  confirmDisabled?: boolean;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog {...(open !== undefined ? { open } : {})} {...(onOpenChange ? { onOpenChange } : {})}>
      {trigger && <AlertDialogTrigger asChild>{trigger}</AlertDialogTrigger>}
      <AlertDialogContent dir="rtl" className="sm:max-w-sm" {...(description ? {} : { "aria-describedby": undefined })}>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          {description && <AlertDialogDescription>{description}</AlertDialogDescription>}
        </AlertDialogHeader>
        {children}
        <AlertDialogFooter>
          <AlertDialogCancel>{cancelLabel}</AlertDialogCancel>
          <AlertDialogAction
            disabled={confirmDisabled}
            className={destructive ? buttonVariants({ variant: "destructive" }) : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

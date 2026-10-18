import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";

export interface LightboxImage {
  src: string;
  alt: string;
}

/**
 * A chat image full screen, inside the app. Opening the data: URL in a new tab left the
 * Home-Screen app for a blank Safari page with no way back.
 */
export function ImageLightbox({ image, onClose }: { image: LightboxImage | null; onClose: () => void }) {
  return (
    <DialogPrimitive.Root open={!!image} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/90 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=closed]:animate-out data-[state=closed]:fade-out-0" />
        <DialogPrimitive.Content
          dir="rtl"
          aria-describedby={undefined}
          onClick={onClose}
          className="fixed inset-0 z-50 grid place-items-center px-3 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-[calc(3.75rem+env(safe-area-inset-top))] outline-none"
        >
          <DialogPrimitive.Title className="sr-only">{image?.alt ?? "صورة"}</DialogPrimitive.Title>
          {image && (
            <img
              src={image.src}
              alt={image.alt}
              onClick={(e) => e.stopPropagation()}
              className="size-full rounded-lg object-contain"
            />
          )}
          <DialogPrimitive.Close className="absolute end-3 top-[calc(0.5rem+env(safe-area-inset-top))] grid size-11 place-items-center rounded-full bg-white/15 text-white active:bg-white/25">
            <X className="size-5" />
            <span className="sr-only">إغلاق</span>
          </DialogPrimitive.Close>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

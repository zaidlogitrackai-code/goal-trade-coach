import { memo, type ReactNode } from "react";
import { AgentActions, type StoredAction } from "@/components/agent-actions";
import { Md } from "@/components/md";
import type { LightboxImage } from "@/components/image-lightbox";
import type { Tables } from "@/integrations/supabase/types";

export type ChatMessage = Pick<Tables<"coach_messages">, "id" | "role" | "content" | "actions" | "image" | "created_at">;

/**
 * His own message, on the start side (right in Arabic). Logical classes so the tail and side
 * follow the page direction; dir=auto on the text alone, so an English message reads
 * left-to-right without moving the bubble.
 */
export function UserBubble({ children, extra }: { children: ReactNode; extra?: ReactNode }) {
  return (
    <div className="me-auto w-fit max-w-[82%] break-words rounded-2xl rounded-ss-md bg-primary px-3.5 py-2 text-base leading-[1.75] text-primary-foreground md:text-sm md:leading-6">
      <p dir="auto" className="whitespace-pre-wrap">{children}</p>
      {extra}
    </div>
  );
}

export function TypingBubble() {
  return <div className="w-fit rounded-2xl bg-muted px-4 py-2 text-sm text-muted-foreground">يكتب…</div>;
}

interface RowProps {
  m: ChatMessage;
  /** Only the reply that just arrived runs its actions by itself (auto mode). */
  autoRun: boolean;
  onActions: (id: string, next: StoredAction[]) => Promise<void>;
  onOpenImage: (image: LightboxImage) => void;
}

/**
 * One message. Memoized on the row object (React Query keeps unchanged rows identical across
 * refetches) so typing or a new reply re-renders only what changed, not the whole thread.
 */
export const MessageRow = memo(function MessageRow({ m, autoRun, onActions, onOpenImage }: RowProps) {
  const image = typeof m.image === "string" ? m.image : null;
  if (m.role === "user") {
    return (
      <UserBubble
        extra={image && (
          <button type="button" className="mt-2 block" aria-label="كبّر الصورة" onClick={() => onOpenImage({ src: image, alt: "الصورة المرفقة" })}>
            <img src={image} alt="الصورة المرفقة" className="max-h-16 w-auto rounded-lg" />
          </button>
        )}
      >
        {m.content}
      </UserBubble>
    );
  }
  const actions = Array.isArray(m.actions) ? (m.actions as unknown as StoredAction[]) : [];
  return (
    <div className="w-full min-w-0 break-words text-base leading-[1.75] md:text-sm md:leading-6">
      <Md>{m.content}</Md>
      {image && (
        <button type="button" className="mt-2 inline-block" aria-label="كبّر الشارت" onClick={() => onOpenImage({ src: image, alt: "الشارت اللي شافه المحلل" })}>
          <img src={image} alt="الشارت اللي شافه المحلل" className="max-h-24 w-auto rounded-lg border border-border" />
        </button>
      )}
      {actions.length > 0 && (
        <div className="mt-3 border-t border-border pt-3">
          <AgentActions
            actions={actions}
            {...(autoRun ? { autoRunKey: m.id } : {})}
            onChange={(next) => onActions(m.id, next)}
          />
        </div>
      )}
    </div>
  );
});

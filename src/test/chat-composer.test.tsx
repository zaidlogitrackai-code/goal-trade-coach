import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useRef, useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : () => chain),
  });
  return { supabase: { from: () => chain, auth: { getSession: async () => ({ data: { session: { user: { id: "u1" } } } }) } } };
});
vi.mock("@tanstack/react-start", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-start")>()),
  useServerFn: () => vi.fn(async () => null),
}));
const { prepareImage } = vi.hoisted(() => ({ prepareImage: vi.fn(async () => "data:image/jpeg;base64,AAAA") }));
vi.mock("@/lib/image", async (orig) => ({ ...(await orig<typeof import("@/lib/image")>()), prepareImage }));

import { ChatComposer } from "@/components/chat-composer";
import { SessionAgent } from "@/components/session-agent";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const realMatchMedia = window.matchMedia;
/** Pretends to be a touch screen (the iPhone keyboard). */
function asTouch() {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: query.includes("pointer: coarse") })) as typeof window.matchMedia;
}
afterEach(() => { window.matchMedia = realMatchMedia; prepareImage.mockClear(); });

const png = new File(["x"], "shot.png", { type: "image/png" });

function Composer({ onSend, onImage = () => {} }: { onSend: () => void; onImage?: (v: string | null) => void }) {
  const [text, setText] = useState("");
  const taRef = useRef<HTMLTextAreaElement>(null);
  return (
    <ChatComposer text={text} onText={setText} image={null} onImage={onImage} busy={false} recording={false}
      placeholder="اكتب رسالتك…" onSend={onSend} onToggleRecord={() => {}} taRef={taRef} />
  );
}

describe("ChatComposer", () => {
  it("a hardware keyboard sends on Enter; Shift+Enter is a newline", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByPlaceholderText("اكتب رسالتك…");
    expect(box).toHaveAttribute("enterkeyhint", "send");
    fireEvent.change(box, { target: { value: "هلا" } });
    fireEvent.keyDown(box, { key: "Enter", shiftKey: true });
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.keyDown(box, { key: "Enter" });
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("on the iPhone keyboard Return is a newline and only the button sends", () => {
    asTouch();
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByPlaceholderText("اكتب رسالتك…");
    expect(box).toHaveAttribute("enterkeyhint", "enter");
    fireEvent.change(box, { target: { value: "سطر أول" } });
    expect(fireEvent.keyDown(box, { key: "Enter" })).toBe(true); // not prevented: the newline goes in
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "إرسال" }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it("never sends a word that is still being composed", () => {
    const onSend = vi.fn();
    render(<Composer onSend={onSend} />);
    const box = screen.getByPlaceholderText("اكتب رسالتك…");
    fireEvent.change(box, { target: { value: "مرحب" } });
    fireEvent.keyDown(box, { key: "Enter", isComposing: true });
    expect(onSend).not.toHaveBeenCalled();
  });

  it("send stays disabled with nothing to send", () => {
    render(<Composer onSend={() => {}} />);
    expect(screen.getByRole("button", { name: "إرسال" })).toBeDisabled();
  });

  it("a screenshot pasted into the box is attached", async () => {
    const onImage = vi.fn();
    render(<Composer onSend={() => {}} onImage={onImage} />);
    fireEvent.paste(screen.getByPlaceholderText("اكتب رسالتك…"), { clipboardData: { files: [png], items: [] } });
    await waitFor(() => expect(onImage).toHaveBeenCalledWith("data:image/jpeg;base64,AAAA"));
  });
});

describe("SessionAgent", () => {
  function renderChat() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    return render(
      <QueryClientProvider client={qc}>
        <SessionAgent threadId="00000000-0000-4000-8000-000000000001" quick={[]} />
        <label htmlFor="other">ملاحظة</label><input id="other" />
      </QueryClientProvider>,
    );
  }

  it("a paste into another input on the page never attaches an image to the chat", async () => {
    renderChat();
    fireEvent.paste(screen.getByLabelText("ملاحظة"), { clipboardData: { files: [png], items: [] } });
    await new Promise((r) => setTimeout(r, 0));
    expect(prepareImage).not.toHaveBeenCalled();
    expect(screen.queryByText("صورة مرفقة")).toBeNull();
  });

  it("locks the page scroll only while the chat is on screen", () => {
    const { unmount } = renderChat();
    expect(document.documentElement).toHaveAttribute("data-chat");
    unmount();
    expect(document.documentElement).not.toHaveAttribute("data-chat");
  });
});

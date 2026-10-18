import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const { navigate } = vi.hoisted(() => ({ navigate: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: [], error: null }) : () => chain),
  });
  return { supabase: { from: () => chain, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } } };
});
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  useNavigate: () => navigate,
}));
vi.mock("@tanstack/react-start", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-start")>()),
  useServerFn: () => vi.fn(async () => null),
}));

import { ResponsiveSheet } from "@/components/responsive-sheet";
import { NotificationsBell } from "@/components/notifications-bell";
import { enterMovesToNextField } from "@/lib/form-keys";

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

const realMatchMedia = window.matchMedia;
/** Pretends to be an iPhone-width screen for queries that ask about max-width 767px. */
function asPhone() {
  window.matchMedia = ((query: string) => ({ ...realMatchMedia(query), matches: query.includes("max-width: 767px") })) as typeof window.matchMedia;
}
afterEach(() => { window.matchMedia = realMatchMedia; navigate.mockClear(); });

function Form({ onSubmit }: { onSubmit: () => void }) {
  return (
    <ResponsiveSheet open title="إغلاق صفقة" onSubmit={onSubmit} onKeyDown={enterMovesToNextField}>
      <label htmlFor="a">المبلغ</label><input id="a" />
      <label htmlFor="b">سعر الخروج</label><input id="b" />
      <button type="submit">حفظ النتيجة</button>
    </ResponsiveSheet>
  );
}

describe("ResponsiveSheet", () => {
  it("is a dialog from 768px up, and its form saves only from the button", () => {
    const onSubmit = vi.fn();
    render(<Form onSubmit={onSubmit} />);
    expect(screen.getByRole("dialog")).toHaveTextContent("إغلاق صفقة");
    const amount = screen.getByLabelText("المبلغ");
    amount.focus();
    fireEvent.keyDown(amount, { key: "Enter" });
    expect(document.activeElement).toBe(screen.getByLabelText("سعر الخروج"));
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "حفظ النتيجة" }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("is a swipe-down drawer on the phone", () => {
    asPhone();
    render(<Form onSubmit={() => {}} />);
    const sheet = screen.getByRole("dialog");
    expect(sheet).toHaveAttribute("data-vaul-drawer");
    expect(screen.getByRole("button", { name: "إغلاق" })).toBeInTheDocument();
  });
});

describe("notifications bell", () => {
  const TRADE = "6f1c2a9e-4b7d-4c1a-9a51-0d3e8f7b2c10";
  function renderBell() {
    const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
    qc.setQueryData(["notifications"], [
      { id: "n1", kind: "risk", dedupe_key: `nosl:${TRADE}`, title: "حط وقف الخسارة على XAUUSD", body: "صفقتك مفتوحة بدون وقف.", created_at: "2026-10-18T06:00:00Z", read: false, dismissed: false, day: "2026-10-18", user_id: "u1" },
    ]);
    render(<QueryClientProvider client={qc}><NotificationsBell /></QueryClientProvider>);
  }

  it("has a 44pt trigger and opens a drawer on the phone", async () => {
    asPhone();
    renderBell();
    const bell = screen.getByRole("button", { name: /الإشعارات/ });
    expect(bell.className).toContain("size-11");
    fireEvent.click(bell);
    await waitFor(() => expect(screen.getByRole("dialog")).toHaveAttribute("data-vaul-drawer"));
  });

  it("tapping «حط الوقف» opens that trade", async () => {
    renderBell();
    fireEvent.click(screen.getByRole("button", { name: /الإشعارات/ }));
    fireEvent.click(await screen.findByRole("button", { name: /افتح الصفقة/ }));
    expect(navigate).toHaveBeenCalledWith({ to: "/trades", search: { trade: TRADE } });
  });

  it("a tapped row expands instead of staying clamped", async () => {
    renderBell();
    fireEvent.click(screen.getByRole("button", { name: /الإشعارات/ }));
    const row = await screen.findByRole("button", { expanded: false });
    fireEvent.click(row);
    expect(row).toHaveAttribute("aria-expanded", "true");
    expect(row.querySelector(".line-clamp-3")).toBeNull();
  });
});

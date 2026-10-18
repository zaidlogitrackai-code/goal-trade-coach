import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { EMPTY_FOCUS } from "@/lib/focus";

// Every database call goes through `from`, so "saved nothing" means no call for "trades".
// Signed in, and any query chain resolves, so a save that slips through really reaches it.
const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock("@/integrations/supabase/client", () => {
  const chain: Record<string, unknown> = new Proxy({}, {
    get: (_, k) => (k === "then" ? (ok: (v: unknown) => void) => ok({ data: { id: "t1" }, error: null }) : () => chain),
  });
  from.mockImplementation(() => chain);
  return { supabase: { from, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } } };
});
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  Link: ({ children }: { children?: ReactNode }) => <a>{children}</a>,
  useNavigate: () => vi.fn(),
}));
vi.mock("@tanstack/react-start", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-start")>()),
  useServerFn: () => vi.fn(async () => null),
}));

import NewTrade from "@/routes/_authenticated/new-trade";

// Radix checkboxes measure themselves; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} };

function renderForm() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["settings"], {
    user_id: "u1", timezone: "Asia/Riyadh", currency: "USD", starting_balance: 10000, created_at: "2026-01-01T00:00:00Z",
    max_risk_per_trade: 100, daily_target: 0, max_daily_profit: 0, max_daily_loss: 0, max_trades_per_day: 0,
    max_daily_risk: 0, max_consecutive_losses: 0, trading_paused: false, cooldown_until: null,
  });
  qc.setQueryData(["trades"], []);
  qc.setQueryData(["violations"], []);
  qc.setQueryData(["strategies"], [{ id: "s1", name: "اختراق", allowed: true, markets: null }]);
  qc.setQueryData(["focus"], { ...EMPTY_FOCUS });
  qc.setQueryData(["sessions"], []);
  qc.setQueryData(["capital"], { entries: [] });
  render(<QueryClientProvider client={qc}><NewTrade /></QueryClientProvider>);
}

async function openManual() {
  fireEvent.click(screen.getByText("أو عبّيها يدويًا (اختياري)"));
  await waitFor(() => expect(screen.getByRole("button", { name: /^اكتب / })).toBeInTheDocument());
}

const field = (label: string) => screen.getByLabelText(label) as HTMLInputElement;
const type = (label: string, value: string) => fireEvent.change(field(label), { target: { value } });

/** Lets a save that slipped through reach the database mock before asserting it didn't. */
const settle = () => new Promise((r) => setTimeout(r, 50));

/** Presses Return the way iOS Safari does: an unhandled Return submits the form. */
function pressReturn(el: HTMLElement) {
  const unhandled = fireEvent.keyDown(el, { key: "Enter" });
  if (unhandled && el instanceof HTMLInputElement) el.form?.requestSubmit();
  return unhandled;
}

describe("new trade form on iPhone", () => {
  beforeEach(() => from.mockClear());

  it("Return on the symbol field moves to the entry price and saves nothing", async () => {
    renderForm();
    await openManual();
    type("الأصل المالي", "EURUSD");
    field("الأصل المالي").focus();
    expect(pressReturn(field("الأصل المالي"))).toBe(false);
    expect(document.activeElement).toBe(field("سعر الدخول"));
    await settle();
    expect(from).not.toHaveBeenCalledWith("trades");
  });

  it("a submit with only the symbol and entry typed saves nothing", async () => {
    renderForm();
    await openManual();
    type("الأصل المالي", "EURUSD");
    type("سعر الدخول", "1.0850");
    field("سعر الدخول").form!.requestSubmit();
    await settle();
    expect(from).not.toHaveBeenCalledWith("trades");
  });

  it("the save button wakes up only once symbol, entry and stop all parse", async () => {
    renderForm();
    await openManual();
    expect(screen.getByRole("button", { name: /^اكتب / })).toBeDisabled();
    type("الأصل المالي", "EURUSD");
    type("سعر الدخول", "١٫٠٨٥٠"); // Arabic-region decimal pad
    expect(screen.getByRole("button", { name: "اكتب وقف الخسارة" })).toBeDisabled();
    type("وقف الخسارة (إلزامي)", "1,0800");
    expect(screen.getByRole("button", { name: "تسجيل الصفقة" })).toBeEnabled();
  });

  it("Return in the notes box still types a new line", async () => {
    renderForm();
    await openManual();
    expect(fireEvent.keyDown(screen.getByLabelText("ملاحظات الصفقة"), { key: "Enter" })).toBe(true);
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

// Every write goes through `from(table).insert(row)`; reads resolve empty.
const { inserts } = vi.hoisted(() => ({ inserts: [] as { table: string; row: unknown }[] }));
vi.mock("@/integrations/supabase/client", () => {
  const table = (name: string) => {
    const chain: Record<string, unknown> = new Proxy({}, {
      get: (_, k) => {
        if (k === "then") return (ok: (v: unknown) => void) => ok({ data: [], error: null });
        if (k === "insert") return (row: unknown) => { inserts.push({ table: name, row }); return chain; };
        return () => chain;
      },
    });
    return chain;
  };
  return { supabase: { from: table, auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) } } };
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

import { Route } from "@/routes/_authenticated/rules";

const Rules = Route.options.component!;

function renderRules() {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(["rules"], [{ id: "r1", user_id: "u1", title: "لا أتداول بعد خسارتين", description: null, active: true, created_at: "2026-10-01T00:00:00Z" }]);
  qc.setQueryData(["violations"], []);
  render(<QueryClientProvider client={qc}><Rules /></QueryClientProvider>);
}

const violationInserts = () => inserts.filter((x) => x.table === "rule_violations");
/** Lets an insert that slipped through reach the mock before asserting it didn't. */
const settle = () => new Promise((r) => setTimeout(r, 50));

describe("logging a rule violation", () => {
  beforeEach(() => { inserts.length = 0; });

  it("cancelling the confirmation inserts nothing", async () => {
    renderRules();
    fireEvent.click(screen.getByRole("button", { name: "سجّل مخالفة" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(screen.getByLabelText("وش صار؟ (اختياري)"), { target: { value: "دخلت انتقام" } });
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(dialog).not.toBeInTheDocument());
    await settle();
    expect(violationInserts()).toHaveLength(0);
  });

  it("confirming logs one violation with the note", async () => {
    renderRules();
    fireEvent.click(screen.getByRole("button", { name: "سجّل مخالفة" }));
    await screen.findByRole("alertdialog");
    fireEvent.change(screen.getByLabelText("وش صار؟ (اختياري)"), { target: { value: "  دخلت انتقام  " } });
    fireEvent.click(screen.getByRole("button", { name: "سجّل المخالفة" }));
    await waitFor(() => expect(violationInserts()).toHaveLength(1));
    expect(violationInserts()[0]!.row).toMatchObject({ rule_id: "r1", note: "دخلت انتقام", user_id: "u1" });
  });

  it("a fresh dialog starts without the last note", async () => {
    renderRules();
    fireEvent.click(screen.getByRole("button", { name: "سجّل مخالفة" }));
    await screen.findByRole("alertdialog");
    fireEvent.change(screen.getByLabelText("وش صار؟ (اختياري)"), { target: { value: "قديم" } });
    fireEvent.click(screen.getByRole("button", { name: "إلغاء" }));
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "سجّل مخالفة" }));
    await screen.findByRole("alertdialog");
    expect((screen.getByLabelText("وش صار؟ (اختياري)") as HTMLTextAreaElement).value).toBe("");
  });
});

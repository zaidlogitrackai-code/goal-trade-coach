import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ navigate: vi.fn(), back: vi.fn(), canGoBack: false, pathname: "/risk" }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@tanstack/react-router", async (orig) => ({
  ...(await orig<typeof import("@tanstack/react-router")>()),
  Link: ({ children, "aria-label": label }: { children?: ReactNode; "aria-label"?: string }) => <a aria-label={label}>{children}</a>,
  useNavigate: () => nav.navigate,
  useRouter: () => ({ history: { back: nav.back } }),
  useCanGoBack: () => nav.canGoBack,
  useLocation: () => ({ pathname: nav.pathname }),
}));

import { ChatHeader, NavBar } from "@/components/app-shell";

afterEach(() => {
  nav.navigate.mockClear();
  nav.back.mockClear();
  nav.canGoBack = false;
});

describe("iOS nav bar", () => {
  it("shows the page's large title and the gear", () => {
    render(<NavBar pathname="/risk" bell={false} />);
    expect(screen.getByText("حارس المخاطر")).toBeInTheDocument();
    expect(screen.getByLabelText("الإعدادات")).toBeInTheDocument();
  });

  it("has no back chevron on a tab", () => {
    render(<NavBar pathname="/coach" bell={false} />);
    expect(screen.getByText("سَنَد")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "رجوع" })).toBeNull();
  });

  it("goes back to the screen he came from", () => {
    nav.canGoBack = true;
    render(<NavBar pathname="/strategies" bell={false} />);
    fireEvent.click(screen.getByRole("button", { name: "رجوع" }));
    expect(nav.back).toHaveBeenCalledTimes(1);
    expect(nav.navigate).not.toHaveBeenCalled();
  });

  it("falls back to home when the app opened right on the page", () => {
    render(<NavBar pathname="/strategies" bell={false} />);
    fireEvent.click(screen.getByRole("button", { name: "رجوع" }));
    expect(nav.back).not.toHaveBeenCalled();
    expect(nav.navigate).toHaveBeenCalledWith({ to: "/dashboard", replace: true });
  });
});

describe("ChatHeader", () => {
  it("keeps the page title for screen readers only on the phone, where the nav bar shows it", () => {
    nav.pathname = "/analyst";
    render(<ChatHeader status="ارفع الشارت" actions={<button type="button">محادثة جديدة</button>} />);
    const title = screen.getByRole("heading", { name: "المحلل الذكي" });
    expect(title.className).toContain("max-lg:sr-only");
    expect(screen.getByText("ارفع الشارت")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "محادثة جديدة" })).toBeInTheDocument();
  });
});

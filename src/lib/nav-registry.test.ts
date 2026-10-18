import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { describe, expect, it } from "vitest";
import { routeTree } from "@/routeTree.gen";
import { backTarget, MORE, NAV, NAV_GROUPS, navEntry, SIDEBAR, TABS } from "./nav-registry";

/** Every page the router can show inside the signed-in shell (the layout, landing, login and setup aside). */
function shellRoutes(): string[] {
  const router = createRouter({ routeTree, context: { queryClient: new QueryClient() } });
  return Object.keys(router.routesByPath).filter((p) => !["/", "/auth", "/onboarding"].includes(p));
}

describe("nav registry", () => {
  it("lists every page of the shell, and only real pages", () => {
    const routes = shellRoutes();
    expect(routes.length).toBeGreaterThan(10);
    expect(NAV.map((n) => n.path).sort()).toEqual([...routes].sort());
  });

  it("reaches every page from the phone: a tab or one row of the «المزيد» sheet", () => {
    const sheet = MORE.flatMap((g) => g.items.map((n) => n.path));
    expect(new Set(sheet).size).toBe(sheet.length);
    for (const p of shellRoutes()) {
      const tab = TABS.some((t) => t.path === p);
      expect(tab !== sheet.includes(p as never), p).toBe(true);
    }
  });

  it("keeps the four tabs in their places, and groups the rest in step order", () => {
    expect(TABS.map((t) => t.path)).toEqual(["/dashboard", "/session", "/new-trade", "/coach"]);
    expect(MORE.map((g) => g.title)).toEqual(["اليوم", "المراجعة", "الإعداد", "النظام"]);
    expect(SIDEBAR.map((g) => g.id)).toEqual(NAV_GROUPS.map((g) => g.id));
    expect(SIDEBAR.flatMap((g) => g.items)).toHaveLength(NAV.length);
  });

  it("gives every page a title and a label", () => {
    for (const n of NAV) {
      expect(n.title.trim(), n.path).not.toBe("");
      expect(n.label.trim(), n.path).not.toBe("");
    }
  });

  it("finds the page for nested and trailing-slash paths, and nothing outside the shell", () => {
    expect(navEntry("/trades")?.path).toBe("/trades");
    expect(navEntry("/trades/")?.path).toBe("/trades");
    expect(navEntry("/session/x")?.path).toBe("/session");
    // A prefix of a word is not the page: /rules is not /rules-old.
    expect(navEntry("/rules-old")).toBeNull();
    expect(navEntry("/auth")).toBeNull();
  });
});

describe("backTarget", () => {
  it("has no back chevron on a tab", () => {
    for (const t of TABS) expect(backTarget(t.path), t.path).toBeNull();
    expect(backTarget("/coach/")).toBeNull();
  });
  it("falls back to home from every other page", () => {
    for (const n of NAV.filter((x) => !x.tabRoot)) expect(backTarget(n.path), n.path).toBe("/dashboard");
    expect(backTarget("/strategies/")).toBe("/dashboard");
  });
  it("sends an unknown page home too", () => {
    expect(backTarget("/nope")).toBe("/dashboard");
  });
});

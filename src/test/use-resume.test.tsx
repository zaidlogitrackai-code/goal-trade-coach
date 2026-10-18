import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useBeat, useHeartbeat } from "@/hooks/use-resume";
import type { Beat } from "@/lib/heartbeat";

let visibility: DocumentVisibilityState = "visible";
Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });

function setVisible(next: DocumentVisibilityState) {
  visibility = next;
  act(() => { document.dispatchEvent(new Event("visibilitychange")); });
}

function App({ onBeat }: { onBeat: (b: Beat) => void }) {
  useHeartbeat();
  useBeat(onBeat);
  return null;
}

function setup() {
  const qc = new QueryClient();
  const invalidate = vi.spyOn(qc, "invalidateQueries").mockResolvedValue(undefined);
  const beats: Beat[] = [];
  const wrap = ({ children }: { children: ReactNode }) => <QueryClientProvider client={qc}>{children}</QueryClientProvider>;
  const view = render(<App onBeat={(b) => beats.push(b)} />, { wrapper: wrap });
  const keys = () => invalidate.mock.calls.map(([f]) => JSON.stringify(f?.queryKey));
  return { invalidate, beats, keys, view };
}

describe("useHeartbeat on the iPhone", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    visibility = "visible";
  });
  afterEach(() => vi.useRealTimers());

  it("re-reads trades and the bell once a visible minute and tells the watchers", () => {
    const { beats, keys } = setup();
    act(() => { vi.advanceTimersByTime(60_000); });
    expect(beats).toEqual(["tick"]);
    expect(keys()).toEqual(['["trades"]', '["notifications"]']);
  });

  it("stays silent while he is in MT5, then refreshes everything at once on return", () => {
    const { beats, keys, invalidate } = setup();
    setVisible("hidden");
    act(() => { vi.advanceTimersByTime(5 * 60_000); });
    expect(beats).toEqual([]);
    expect(invalidate).not.toHaveBeenCalled();
    setVisible("visible");
    expect(beats).toEqual(["resume"]);
    expect(keys()).toEqual(['["trades"]', '["settings"]', '["notifications"]', '["daily_plan"]', '["sessions"]', '["messages"]']);
  });

  it("a glance at another app for a few seconds refreshes nothing", () => {
    const { beats } = setup();
    setVisible("hidden");
    act(() => { vi.advanceTimersByTime(4_000); });
    setVisible("visible");
    expect(beats).toEqual([]);
  });

  it("stops listening when unmounted", () => {
    const { beats, view } = setup();
    view.unmount();
    act(() => { vi.advanceTimersByTime(3 * 60_000); });
    expect(beats).toEqual([]);
  });
});

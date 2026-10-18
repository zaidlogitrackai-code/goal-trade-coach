import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toast } = vi.hoisted(() => {
  const toast = Object.assign(vi.fn((..._args: unknown[]) => "toast-1"), { dismiss: vi.fn() });
  return { toast };
});
vi.mock("sonner", () => ({ toast }));

import { deleteWithUndo, isPendingDelete, UNDO_MS } from "./undo-delete";

/** Taps «تراجع» on the toast the last call showed. */
function tapUndo() {
  const opts = toast.mock.calls.at(-1)![1] as { action: { label: string; onClick: () => void } };
  expect(opts.action.label).toBe("تراجع");
  opts.action.onClick();
}

describe("deleteWithUndo", () => {
  beforeEach(() => { vi.useFakeTimers(); toast.mockClear(); toast.dismiss.mockClear(); });
  afterEach(() => vi.useRealTimers());

  it("deletes only after the undo window", async () => {
    const commit = vi.fn(async () => {});
    deleteWithUndo({ key: "a", message: "انحذفت", commit });
    expect(isPendingDelete("a")).toBe(true);
    vi.advanceTimersByTime(UNDO_MS - 1);
    expect(commit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(isPendingDelete("a")).toBe(false);
  });

  it("تراجع cancels the delete and restores the row", () => {
    const commit = vi.fn(async () => {});
    const onUndo = vi.fn();
    deleteWithUndo({ key: "b", message: "انحذفت", commit, onUndo });
    tapUndo();
    vi.advanceTimersByTime(UNDO_MS * 2);
    expect(commit).not.toHaveBeenCalled();
    expect(onUndo).toHaveBeenCalledTimes(1);
    expect(isPendingDelete("b")).toBe(false);
  });

  it("leaving the app deletes at once instead of never", () => {
    const commit = vi.fn(async () => {});
    deleteWithUndo({ key: "c", message: "انحذفت", commit });
    window.dispatchEvent(new Event("pagehide"));
    expect(commit).toHaveBeenCalledTimes(1);
    // The timer no longer fires a second delete, and a late undo does nothing.
    tapUndo();
    vi.advanceTimersByTime(UNDO_MS);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("a second tap on the same row does not queue a second delete", () => {
    const commit = vi.fn(async () => {});
    deleteWithUndo({ key: "d", message: "انحذفت", commit });
    deleteWithUndo({ key: "d", message: "انحذفت", commit });
    vi.advanceTimersByTime(UNDO_MS);
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it("reports a failed delete", async () => {
    const onError = vi.fn();
    deleteWithUndo({ key: "e", message: "انحذفت", commit: async () => { throw new Error("rls"); }, onError });
    vi.advanceTimersByTime(UNDO_MS);
    await vi.waitFor(() => expect(onError).toHaveBeenCalled());
  });
});

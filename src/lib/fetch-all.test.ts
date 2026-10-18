import { describe, expect, it, vi } from "vitest";
import { fetchAll } from "./fetch-all";

const rows = Array.from({ length: 2500 }, (_, i) => ({ id: i }));
const table = (from: number, to: number) =>
  Promise.resolve({ data: rows.slice(from, to + 1), error: null });

describe("fetchAll", () => {
  it("pages past the 1000-row cap: 2,500 rows arrive in 3 pages", async () => {
    const range = vi.fn(table);
    const all = await fetchAll(range);
    expect(all).toHaveLength(2500);
    expect(all[2499]).toEqual({ id: 2499 });
    expect(range.mock.calls).toEqual([
      [0, 999],
      [1000, 1999],
      [2000, 2999],
    ]);
  });

  it("stops after one request when everything fits", async () => {
    const range = vi.fn((from: number, to: number) =>
      Promise.resolve({ data: rows.slice(0, 12).slice(from, to + 1), error: null }),
    );
    expect(await fetchAll(range)).toHaveLength(12);
    expect(range).toHaveBeenCalledTimes(1);
  });

  it("throws on an error instead of returning a partial history", async () => {
    let call = 0;
    const range = (from: number, to: number) =>
      call++ === 0 ? table(from, to) : Promise.resolve({ data: null, error: { message: "timeout" } });
    await expect(fetchAll(range)).rejects.toThrow("timeout");
  });
});

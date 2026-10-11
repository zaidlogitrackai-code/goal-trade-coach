import { describe, expect, it, vi } from "vitest";
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { parseAction } from "./agent-actions";

describe("agent actions", () => {
  it("accepts valid settings with weekly/monthly targets", () => {
    expect(parseAction({ type: "update_settings", summary: "", data: '{"weekly_target":500,"monthly_max_loss":"1500"}' })).toEqual({ weekly_target: 500, monthly_max_loss: 1500 });
  });
  it("rejects negative limits and unknown types", () => {
    expect(parseAction({ type: "update_settings", summary: "", data: '{"max_daily_loss":-5}' })).toBeNull();
    expect(parseAction({ type: "delete_all" as never, summary: "", data: "{}" })).toBeNull();
  });
});

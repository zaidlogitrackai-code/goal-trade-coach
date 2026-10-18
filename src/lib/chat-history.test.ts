import { describe, expect, it } from "vitest";
import { actionOutcomes, HISTORY_LIMIT, toModelInput, type HistoryRow } from "./chat-history";
import { IMAGE_NOTE } from "./chat-retry";

const IMG = "data:image/png;base64,AAAA";
const thread = (n: number): HistoryRow[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? "assistant" : "user", content: `m${i}` }));
const texts = (turns: ReturnType<typeof toModelInput>) =>
  turns.map((t) => (typeof t.content === "string" ? t.content : t.content.map((p) => (p.type === "input_text" ? p.text : "[img]")).join(" ")));

describe("toModelInput", () => {
  it("sends the newest 40 in order, ending with the current message", () => {
    const rows = [...thread(59), { role: "user", content: "آخر رسالة" }];
    const out = toModelInput(rows, "آخر رسالة");
    expect(out).toHaveLength(HISTORY_LIMIT);
    expect(texts(out)).toEqual(rows.slice(-40).map((r) => r.content));
    expect(out.at(-1)).toEqual({ role: "user", content: "آخر رسالة" });
  });

  it("sends the image turn once, without the saved text copy before it", () => {
    const rows = [...thread(4), { role: "user", content: `حلل${IMAGE_NOTE}` }];
    const out = toModelInput(rows, "حلل", { image: IMG });
    expect(out).toHaveLength(5);
    expect(out.filter((t) => texts([t])[0]!.startsWith("حلل"))).toHaveLength(1);
    expect(out.at(-1)).toEqual({
      role: "user",
      content: [{ type: "input_text", text: "حلل" }, { type: "input_image", image_url: IMG, detail: "high" }],
    });
  });

  it("appends the current message when it isn't saved yet, still within 40", () => {
    expect(texts(toModelInput(thread(4), "جديد"))).toEqual(["m0", "m1", "m2", "m3", "جديد"]);
    const out = toModelInput(thread(40), "جديد");
    expect(out).toHaveLength(HISTORY_LIMIT);
    expect(texts(out).at(-2)).toBe("m39");
    expect(texts(out).at(-1)).toBe("جديد");
    // A missing message with an image: only the image turn carries it.
    expect(texts(toModelInput(thread(2), "شوف", { image: IMG }))).toEqual(["m0", "m1", "شوف [img]"]);
  });

  it("keeps a retried message once, image marker included, after a reload", () => {
    const rows = [...thread(2), { role: "user", content: `حلل${IMAGE_NOTE}` }];
    expect(texts(toModelInput(rows, "حلل"))).toEqual(["m0", "m1", `حلل${IMAGE_NOTE}`]);
  });

  it("only drops the last row when it is the same user message", () => {
    const rows = [{ role: "user", content: "تمام" }, { role: "assistant", content: "تمام" }];
    expect(texts(toModelInput(rows, "تمام"))).toEqual(["تمام", "تمام", "تمام"]);
  });

  it("adds the real outcome of each action under the reply", () => {
    const rows: HistoryRow[] = [
      { role: "user", content: "سجل الصفقات" },
      {
        role: "assistant",
        content: "بنفذها لك الحين",
        actions: [
          { type: "create_trade", summary: "صفقة ذهب شراء", data: "{}", status: "done" },
          { type: "create_trade", summary: "صفقة يورو بيع", data: "{}", status: "done", note: "الصفقة مسجّلة من قبل، ما كررتها" },
          { type: "close_trade", summary: "إغلاق الفضة", data: "{}", status: "failed", note: "ما لقيت صفقة مفتوحة" },
          { type: "delete_trade", summary: "حذف صفقة النفط", data: "{}", note: "الحذف يحتاج موافقتك" },
          { type: "update_settings", summary: "رفع حد الخسارة", data: "{}" },
          { type: "add_note", summary: "ملاحظة", data: "{}", status: "rejected" },
        ],
      },
      { role: "user", content: "وش صار؟" },
    ];
    expect(toModelInput(rows, "وش صار؟")[1]).toEqual({
      role: "assistant",
      content: [
        "بنفذها لك الحين",
        "[نتيجة: صفقة ذهب شراء — تم]",
        "[نتيجة: صفقة يورو بيع — تم (الصفقة مسجّلة من قبل، ما كررتها)]",
        "[نتيجة: إغلاق الفضة — فشل: ما لقيت صفقة مفتوحة]",
        "[نتيجة: حذف صفقة النفط — ما تنفّذ، ينتظر موافقة هادي (الحذف يحتاج موافقتك)]",
        "[نتيجة: رفع حد الخسارة — ما تنفّذ، ينتظر موافقة هادي]",
        "[نتيجة: ملاحظة — رفضه هادي]",
      ].join("\n"),
    });
  });

  it("leaves replies without actions, user rows and broken action data untouched", () => {
    expect(actionOutcomes(null)).toEqual([]);
    expect(actionOutcomes("x")).toEqual([]);
    expect(actionOutcomes([null, 3, { type: "add_rule", status: "done" }])).toEqual(["[نتيجة: add_rule — تم]"]);
    const rows: HistoryRow[] = [
      { role: "user", content: "هلا", actions: [{ summary: "x", status: "done" }] },
      { role: "assistant", content: "هلا فيك", actions: null },
      { role: "user", content: "طيب" },
    ];
    expect(texts(toModelInput(rows, "طيب"))).toEqual(["هلا", "هلا فيك", "طيب"]);
  });
});

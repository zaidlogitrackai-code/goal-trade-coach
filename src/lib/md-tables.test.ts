import { describe, expect, it } from "vitest";
import { splitCells, splitTables } from "./md-tables";

describe("splitCells", () => {
  it("trims the outer pipes and every cell", () => {
    expect(splitCells("| XAUUSD | صاعد |")).toEqual(["XAUUSD", "صاعد"]);
    expect(splitCells("a|b")).toEqual(["a", "b"]);
  });
  it("keeps an escaped pipe inside a cell", () => {
    expect(splitCells("| a \\| b | c |")).toEqual(["a | b", "c"]);
  });
});

describe("splitTables", () => {
  it("leaves text without a table as one markdown run", () => {
    expect(splitTables("**الخلاصة**\n\nانتظر")).toEqual([{ kind: "md", text: "**الخلاصة**\n\nانتظر" }]);
  });

  it("pulls out the watchlist table with its alignment and keeps the text around it", () => {
    const md = [
      "نظرة سريعة:",
      "| الأصل | التغير | الاتجاه |",
      "|:---|---:|:---:|",
      "| XAUUSD | +0.8% | صاعد |",
      "| US500 | -0.2% | محايد |",
      "",
      "ارسل شارت الذهب للتفاصيل.",
    ].join("\n");
    expect(splitTables(md)).toEqual([
      { kind: "md", text: "نظرة سريعة:" },
      {
        kind: "table",
        head: ["الأصل", "التغير", "الاتجاه"],
        align: ["start", "end", "center"],
        rows: [["XAUUSD", "+0.8%", "صاعد"], ["US500", "-0.2%", "محايد"]],
      },
      { kind: "md", text: "\nارسل شارت الذهب للتفاصيل." },
    ]);
  });

  it("pads short rows and drops extra cells", () => {
    const [t] = splitTables("| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |");
    expect(t).toEqual({ kind: "table", head: ["a", "b"], align: [null, null], rows: [["1", ""], ["1", "2"]] });
  });

  it("ends the table at a line without a pipe", () => {
    const blocks = splitTables("| a | b |\n|---|---|\n| 1 | 2 |\nوبعدين");
    expect(blocks.map((b) => b.kind)).toEqual(["table", "md"]);
  });

  it("is not a table when the delimiter row doesn't match the header", () => {
    const md = "| a | b |\n|---|\n| 1 | 2 |";
    expect(splitTables(md)).toEqual([{ kind: "md", text: md }]);
  });

  it("never reads a table inside a code fence", () => {
    const md = "```\n| a | b |\n|---|---|\n```";
    expect(splitTables(md)).toEqual([{ kind: "md", text: md }]);
  });

  it("a horizontal rule is not a table", () => {
    const md = "قبل\n\n---\n\nبعد";
    expect(splitTables(md)).toEqual([{ kind: "md", text: md }]);
  });
});

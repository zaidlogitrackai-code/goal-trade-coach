/**
 * GitHub-style pipe tables for the AI's markdown, without remark-gfm (no new dependency: the
 * project's bun.lock can't be regenerated here). The analyst is told to answer a watchlist
 * screenshot with a markdown table; react-markdown alone shows it as raw pipes. Pure.
 */

export type CellAlign = "start" | "center" | "end" | null;

export type MdBlock =
  | { kind: "md"; text: string }
  | { kind: "table"; head: string[]; rows: string[][]; align: CellAlign[] };

/** Cells of one `| a | b |` row; `\|` is a literal pipe. */
export function splitCells(line: string): string[] {
  let s = line.trim();
  if (s.startsWith("|")) s = s.slice(1);
  if (s.endsWith("|") && !s.endsWith("\\|")) s = s.slice(0, -1);
  const cells: string[] = [];
  let cur = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === "\\" && s[i + 1] === "|") { cur += "|"; i++; continue; }
    if (ch === "|") { cells.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  cells.push(cur.trim());
  return cells;
}

const DELIM_CELL = /^:?-+:?$/;

/** The `|---|:---:|` row under a header, as column alignments; null if this isn't one. */
function delimiterRow(line: string): CellAlign[] | null {
  if (!line.includes("|") || !line.includes("-")) return null;
  const cells = splitCells(line);
  if (!cells.every((c) => DELIM_CELL.test(c))) return null;
  return cells.map((c) => {
    const l = c.startsWith(":");
    const r = c.endsWith(":");
    return l && r ? "center" : r ? "end" : l ? "start" : null;
  });
}

/** GFM pads short rows and drops extra cells so every row has the header's columns. */
function fit(cells: string[], n: number): string[] {
  return Array.from({ length: n }, (_, i) => cells[i] ?? "");
}

const FENCE = /^\s{0,3}(`{3,}|~{3,})/;

/** Splits markdown into plain markdown runs and pipe tables, leaving code fences alone. */
export function splitTables(md: string): MdBlock[] {
  const lines = md.split("\n");
  const out: MdBlock[] = [];
  let buf: string[] = [];
  let fence: string | null = null;
  const flush = () => {
    const text = buf.join("\n");
    if (text.trim()) out.push({ kind: "md", text });
    buf = [];
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const f = FENCE.exec(line)?.[1];
    if (f) {
      if (!fence) fence = f;
      else if (f[0] === fence[0] && f.length >= fence.length) fence = null;
      buf.push(line);
      continue;
    }
    if (!fence && line.includes("|") && i + 1 < lines.length) {
      const head = splitCells(line);
      const align = delimiterRow(lines[i + 1]!);
      if (align && align.length === head.length) {
        flush();
        const rows: string[][] = [];
        let j = i + 2;
        // A blank line or a line without a pipe ends the table (the reply's text goes on).
        while (j < lines.length && lines[j]!.trim() !== "" && lines[j]!.includes("|")) {
          rows.push(fit(splitCells(lines[j]!), head.length));
          j++;
        }
        out.push({ kind: "table", head, rows, align });
        i = j - 1;
        continue;
      }
    }
    buf.push(line);
  }
  flush();
  return out;
}

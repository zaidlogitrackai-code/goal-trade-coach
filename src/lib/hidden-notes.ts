import { CAPITAL_CATEGORY } from "./capital";
import { FOCUS_CATEGORY } from "./focus";

/** knowledge_notes categories used as system storage; never shown as notes. For `.not("category", "in", …)`. */
/** Hadi's instructions for how the discipline guard should behave (single row). */
export const GUARD_STYLE_CATEGORY = "__guard_style";
export const HIDDEN_NOTES = `(${FOCUS_CATEGORY},${CAPITAL_CATEGORY},${GUARD_STYLE_CATEGORY})`;
export const isHiddenNote = (category: string | null | undefined) =>
  category === FOCUS_CATEGORY || category === CAPITAL_CATEGORY || category === GUARD_STYLE_CATEGORY;

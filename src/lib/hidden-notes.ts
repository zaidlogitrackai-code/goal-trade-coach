import { CAPITAL_CATEGORY } from "./capital";
import { FOCUS_CATEGORY } from "./focus";

/** knowledge_notes categories used as system storage; never shown as notes. For `.not("category", "in", …)`. */
export const HIDDEN_NOTES = `(${FOCUS_CATEGORY},${CAPITAL_CATEGORY})`;
export const isHiddenNote = (category: string | null | undefined) =>
  category === FOCUS_CATEGORY || category === CAPITAL_CATEGORY;

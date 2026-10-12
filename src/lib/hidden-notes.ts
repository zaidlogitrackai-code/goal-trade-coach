import { CAPITAL_CATEGORY } from "./capital";
import { FOCUS_CATEGORY } from "./focus";

/** knowledge_notes categories used as system storage; never shown as notes. For `.not("category", "in", …)`. */
/** Hadi's instructions for how the discipline guard should behave (single row). */
export const GUARD_STYLE_CATEGORY = "__guard_style";
/** Presence of this row means Hadi switched the use of his strategy training examples OFF (default is ON). */
export const TRAINING_OFF_CATEGORY = "__training_off";
/** Presence of this row means Hadi switched the AI's use of the knowledge center OFF (default is ON). */
export const KNOWLEDGE_OFF_CATEGORY = "__knowledge_off";
export const HIDDEN_NOTES = `(${FOCUS_CATEGORY},${CAPITAL_CATEGORY},${GUARD_STYLE_CATEGORY},${TRAINING_OFF_CATEGORY},${KNOWLEDGE_OFF_CATEGORY})`;
export const isHiddenNote = (category: string | null | undefined) =>
  category === FOCUS_CATEGORY || category === CAPITAL_CATEGORY || category === GUARD_STYLE_CATEGORY || category === TRAINING_OFF_CATEGORY || category === KNOWLEDGE_OFF_CATEGORY;

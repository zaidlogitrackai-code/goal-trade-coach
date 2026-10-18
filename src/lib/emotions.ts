/**
 * One emotion vocabulary for the trade form, AI trade parsing, the gate and the
 * discipline stats — a word chosen in one place must be recognised everywhere.
 */
export const EMOTIONS: readonly string[] = ["هادئ", "واثق", "متوتر", "متحمس", "خائف", "غاضب", "طمع", "خوف من الفوات"];

/** Greed family counted in discipline stats; "انتقام"/"FOMO" still match older free-text rows. */
export const GREED: readonly string[] = ["طمع", "خوف من الفوات", "انتقام", "FOMO"];

/** Emotions that open the reflection check on the form and warn at the gate. */
export const SENSITIVE: readonly string[] = [...GREED, "خائف", "متوتر", "غاضب"];

// Substring match: AI/agent-written rows may carry free text like "طمع شوي".
const has = (list: readonly string[], e: string | null | undefined) => !!e && list.some((w) => e.includes(w));
export const isGreed = (e: string | null | undefined) => has(GREED, e);
export const isSensitive = (e: string | null | undefined) => has(SENSITIVE, e);

/**
 * Written into trade notes when the trader admits the entry is to win back a loss,
 * and read back by the discipline report. Temporary until the answer moves to pre_trade_checks.
 */
export const REVENGE_MARKER = "[هل هو تعويض]: نعم";
export const revengeLine = (yes: boolean) => (yes ? REVENGE_MARKER : "[هل هو تعويض]: لا");

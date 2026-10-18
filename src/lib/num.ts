/**
 * Number input parsing. An iPhone set to an Arabic region types '١٫٠٨' on the
 * decimal pad, which Number() turns into NaN, so every typed number goes through here.
 */
export interface ParsedDecimal {
  /** Parsed number, or null when the text is empty or invalid. */
  value: number | null;
  /** True when something was typed but it isn't a number. */
  invalid: boolean;
}

const DECIMAL = /^[+-]?(\d+\.?\d*|\.\d+)$/;

export function parseDecimal(s: string | null | undefined): ParsedDecimal {
  const t = (s ?? "")
    // Bidi marks and spaces that iOS/WhatsApp copies carry around numbers.
    .replace(/[\s‎‏؜٬]/g, "")
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[٫,]/g, ".")
    .replace(/−/g, "-");
  if (t === "") return { value: null, invalid: false };
  if (!DECIMAL.test(t)) return { value: null, invalid: true };
  const value = Number(t);
  return Number.isFinite(value) ? { value, invalid: false } : { value: null, invalid: true };
}

/** Parsed number or null (empty and invalid both become null). */
export const numOrNull = (s: string | null | undefined) => parseDecimal(s).value;

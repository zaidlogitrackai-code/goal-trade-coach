import type { KeyboardEvent } from "react";

// Inputs where Return has its own meaning (toggle, press) or that take no typing.
const NOT_TYPED = new Set(["checkbox", "radio", "button", "submit", "reset", "image", "hidden", "file", "range", "color"]);

type Field = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Fields a Return press can move to, in form order; disabled ones and closed <details> bodies are skipped. */
function typedFields(form: HTMLFormElement): Field[] {
  return Array.from(form.elements).filter((el): el is Field => {
    if (el instanceof HTMLInputElement) {
      if (NOT_TYPED.has(el.type) || el.readOnly) return false;
    } else if (!(el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement)) return false;
    return !el.disabled && !el.closest("details:not([open]) > :not(summary)");
  });
}

/**
 * Form onKeyDown: Return in a text field moves to the next field instead of submitting.
 * On iPhone the keyboard's Return otherwise saves a half-typed trade through the
 * form's implicit submit. On the last field it just closes the keyboard.
 */
export function enterMovesToNextField(e: KeyboardEvent<HTMLFormElement>) {
  const t = e.target;
  if (e.key !== "Enter" || !(t instanceof HTMLInputElement) || NOT_TYPED.has(t.type)) return;
  if (e.nativeEvent.isComposing) return;
  e.preventDefault();
  const fields = typedFields(e.currentTarget);
  const next = fields[fields.indexOf(t) + 1];
  if (next) next.focus();
  else t.blur();
}

import * as React from "react";

import { Input } from "@/components/ui/input";
import { parseDecimal } from "@/lib/num";
import { cn } from "@/lib/utils";

type NumberFieldProps = Omit<React.ComponentProps<"input">, "type" | "value" | "onChange"> & {
  value: string;
  onValueChange: (value: string) => void;
  /** Shown under the field; a parse error is shown automatically when this is empty. */
  error?: string | null;
};

/**
 * Text field for prices, lots and money. type=number rejects Arabic digits and '٫'
 * on iOS, so the raw text is kept and read with parseDecimal; 16px text stops iOS zooming.
 */
const NumberField = React.forwardRef<HTMLInputElement, NumberFieldProps>(
  ({ value, onValueChange, error, className, id, "aria-describedby": describedBy, ...props }, ref) => {
    const autoId = React.useId();
    const fieldId = id ?? autoId;
    const msg = error || (parseDecimal(value).invalid ? "اكتب رقم صحيح، مثل 1.0850" : null);
    const errId = `${fieldId}-error`;
    return (
      <>
        <Input
          ref={ref}
          id={fieldId}
          type="text"
          inputMode="decimal"
          dir="ltr"
          enterKeyHint="next"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={value}
          onChange={(e) => onValueChange(e.target.value)}
          aria-invalid={msg ? true : undefined}
          aria-describedby={[describedBy, msg ? errId : null].filter(Boolean).join(" ") || undefined}
          className={cn("h-11 font-data text-base md:text-base", className)}
          {...props}
        />
        {msg && (
          <p id={errId} role="alert" className="text-xs text-destructive">
            {msg}
          </p>
        )}
      </>
    );
  },
);
NumberField.displayName = "NumberField";

export { NumberField };

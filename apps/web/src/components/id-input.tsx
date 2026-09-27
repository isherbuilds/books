import { INDIAN_STATES } from "@accly/api/lib/indian-states";
import { gstinParts } from "@accly/api/lib/schemas";
import {
  FormControl,
  FormDescription,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { cn } from "@accly/ui/lib/utils";
import type { ComponentProps } from "react";
import { useFormContext, useWatch } from "react-hook-form";

/**
 * An identifier read character by character (GSTIN, PAN, codes): monospace capitals,
 * no autocomplete or spellcheck, and the capitals keyboard on a phone.
 */
export function IdInput({ className, ...props }: ComponentProps<typeof Input>) {
  return (
    <Input
      autoComplete="off"
      autoCapitalize="characters"
      spellCheck={false}
      {...props}
      className={cn("font-mono uppercase", className)}
    />
  );
}

/**
 * A GSTIN field. A valid number fills the form's state and PAN, and the description
 * under it says what it filled.
 */
export function GstinField({ label, placeholder }: { label: string; placeholder?: string }) {
  const form = useFormContext<{ gstin: string; stateCode: string; pan: string }>();
  const parts = gstinParts(useWatch({ control: form.control, name: "gstin" }) ?? "");

  return (
    <RegisteredFormField
      name="gstin"
      render={({ field }) => (
        <FormItem>
          <FormLabel>{label}</FormLabel>
          <FormControl>
            <IdInput
              {...field}
              maxLength={15}
              placeholder={placeholder}
              onChange={(event) => {
                void field.onChange(event);
                const filled = gstinParts(event.currentTarget.value);

                if (!filled) return;

                form.setValue("stateCode", filled.stateCode, { shouldDirty: true });
                form.setValue("pan", filled.pan, { shouldDirty: true });
              }}
            />
          </FormControl>
          <FormDescription>
            {parts
              ? `${INDIAN_STATES[parts.stateCode]} · PAN ${parts.pan}`
              : "State and PAN come from the GSTIN."}
          </FormDescription>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

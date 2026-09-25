import {
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@accly/ui/components/form";
import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { useFormContext } from "react-hook-form";

import { LinkField } from "@/components/link-field";
import { paymentMethodListOptions } from "@/lib/receipts";

/**
 * The method a new receipt or payment moves money through. Only an active method in an
 * active account can post; the field defaults to Bank transfer, else the first method.
 * Controlled, because its options arrive after the field mounts.
 */
export function PaymentMethodField({ orgSlug }: { orgSlug: string }) {
  const { control, getValues, setValue } = useFormContext<{ paymentMethodId: string }>();

  const methods = useQuery({
    ...paymentMethodListOptions(orgSlug),
    select: (rows) => rows.filter((method) => method.active && method.accountActive),
  });

  const preferred =
    methods.data?.find((method) => method.name.toLocaleLowerCase() === "bank transfer") ??
    methods.data?.[0];

  useEffect(() => {
    if (preferred && !getValues("paymentMethodId")) setValue("paymentMethodId", preferred.id);
  }, [preferred, getValues, setValue]);

  return (
    <FormField
      control={control}
      name="paymentMethodId"
      render={({ field, fieldState }) => (
        <FormItem>
          <FormLabel>Payment method</FormLabel>
          <FormControl>
            <LinkField
              items={methods.data}
              query={methods}
              noun="payment methods"
              getKey={(method) => method.id}
              getLabel={(method) => method.name}
              value={methods.data?.find((method) => method.id === field.value) ?? null}
              onSelect={(method) => field.onChange(method?.id ?? "")}
              placeholder="Choose a payment method"
              inputRef={field.ref}
              aria-invalid={fieldState.invalid}
            />
          </FormControl>
          <FormMessage />
        </FormItem>
      )}
    />
  );
}

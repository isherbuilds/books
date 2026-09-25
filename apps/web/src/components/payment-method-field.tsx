import {
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@accly/ui/components/form";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useFormContext } from "react-hook-form";

import { LinkField } from "@/components/link-field";
import { PaymentMethodSheet } from "@/components/payment-method-sheet";
import { useCan } from "@/lib/membership";
import { BANKS_MANAGE_PERMISSION } from "@/lib/navigation";
import { paymentMethodListOptions } from "@/lib/receipts";

/**
 * The method a new receipt or payment moves money through. Only an active method in an
 * active account can post; the field defaults to Bank transfer, else the first method.
 * Controlled, because its options arrive after the field mounts. With no method, a
 * Banks manager adds one in a stacked Sheet (DocumentForm ignores its portal events),
 * so the document keeps its typed values.
 */
export function PaymentMethodField({ orgSlug }: { orgSlug: string }) {
  const { control, getValues, setValue } = useFormContext<{ paymentMethodId: string }>();
  const canCreate = useCan(orgSlug, BANKS_MANAGE_PERMISSION);
  const [creating, setCreating] = useState(false);

  const methods = useQuery({
    ...paymentMethodListOptions(orgSlug),
    select: (rows) => rows.filter((method) => method.active && method.accountActive),
  });

  const preferred =
    methods.data?.find((method) => method.name.toLocaleLowerCase() === "bank transfer") ??
    methods.data?.[0];

  useEffect(() => {
    if (preferred && !getValues("paymentMethodId")) {
      setValue("paymentMethodId", preferred.id, { shouldValidate: true });
    }
  }, [preferred, getValues, setValue]);

  return (
    <>
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
            {/* No active method would leave the required field a dead end. */}
            {methods.data?.length === 0 ? (
              <FormDescription>
                {canCreate ? (
                  <>
                    No active payment method.{" "}
                    <button
                      type="button"
                      className="text-foreground underline underline-offset-4"
                      onClick={() => setCreating(true)}
                    >
                      Add one
                    </button>
                  </>
                ) : (
                  "No active payment method. Ask an owner or accountant to add one in Banking."
                )}
              </FormDescription>
            ) : null}
            <FormMessage />
          </FormItem>
        )}
      />
      <PaymentMethodSheet
        orgSlug={orgSlug}
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(method) =>
          setValue("paymentMethodId", method.id, { shouldDirty: true, shouldValidate: true })
        }
      />
    </>
  );
}

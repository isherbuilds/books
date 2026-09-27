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
import { activePaymentMethodsOptions } from "@/lib/receipts";

/**
 * The method a new receipt or payment moves money through. Only an active method in an
 * active account can post; the field defaults to Bank transfer, else the first method.
 * Controlled, because its options arrive after the field mounts. With no method, a
 * Banks manager adds one in a stacked Sheet (DocumentForm ignores its portal events),
 * so the document keeps its typed values.
 */
export function PaymentMethodField({
  orgSlug,
  name = "paymentMethodId",
  labelClassName,
}: {
  orgSlug: string;
  /** The form path holding the method id; an Invoice's payment lines pass their own. */
  name?: "paymentMethodId" | `payments.${number}.paymentMethodId`;
  labelClassName?: string;
}) {
  const { control, getValues, setValue } = useFormContext();
  const canCreate = useCan(orgSlug, BANKS_MANAGE_PERMISSION);
  const [creating, setCreating] = useState(false);

  const methods = useQuery(activePaymentMethodsOptions(orgSlug));

  const preferred =
    methods.data?.find((method) => method.name.toLocaleLowerCase() === "bank transfer") ??
    methods.data?.[0];

  useEffect(() => {
    if (preferred && !getValues(name)) {
      setValue(name, preferred.id, { shouldValidate: true });
    }
  }, [preferred, getValues, setValue, name]);

  return (
    <>
      <FormField
        control={control}
        name={name}
        render={({ field }) => (
          <FormItem>
            <FormLabel className={labelClassName}>Payment method</FormLabel>
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
                  "No active payment method. Ask a member who manages Banking to add one."
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
          setValue(name, method.id, { shouldDirty: true, shouldValidate: true })
        }
      />
    </>
  );
}

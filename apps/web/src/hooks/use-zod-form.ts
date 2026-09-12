import { zodResolver } from "@hookform/resolvers/zod";
import { useForm, type FieldValues, type UseFormProps } from "react-hook-form";
import type { z } from "zod";

// Field types are the schema's input; submitted values are its output.
export function useZodForm<Input extends FieldValues, Output extends FieldValues>(
  schema: z.ZodType<Output, Input>,
  options?: Omit<UseFormProps<Input, unknown, Output>, "resolver">,
) {
  return useForm<Input, unknown, Output>({
    resolver: zodResolver<Input, unknown, Output>(schema),
    ...options,
  });
}

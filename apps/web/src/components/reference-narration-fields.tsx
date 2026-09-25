import {
  FormControl,
  FormItem,
  FormLabel,
  FormMessage,
  RegisteredFormField,
} from "@accly/ui/components/form";
import { Input } from "@accly/ui/components/input";
import { Textarea } from "@accly/ui/components/textarea";

/** The optional reference and narration every money document form ends with. */
export function ReferenceNarrationFields() {
  return (
    <>
      <RegisteredFormField
        name="reference"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Reference</FormLabel>
            <FormControl>
              <Input {...field} maxLength={120} autoComplete="off" />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
      <RegisteredFormField
        name="narration"
        render={({ field }) => (
          <FormItem>
            <FormLabel>Narration</FormLabel>
            <FormControl>
              <Textarea {...field} maxLength={500} rows={3} />
            </FormControl>
            <FormMessage />
          </FormItem>
        )}
      />
    </>
  );
}

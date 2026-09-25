import { INDIAN_STATES } from "@accly/api/lib/indian-states";
import type { Ref } from "react";

import { LinkField } from "@/components/link-field";

/** One choice in a fixed list: the stored value and its label. */
export type Option = { code: string; name: string };

// A fixed list never loads, so its query state is constant.
const READY = { isPending: false, isError: false, error: null } as const;

const getKey = (option: Option) => option.code;

const getLabel = (option: Option) => option.name;

/** A Link Field over a fixed list that stores the chosen option's `code`. */
export function OptionField({
  options,
  noun,
  value,
  onChange,
  showCode,
  placeholder,
  inputRef,
  id,
  "aria-invalid": ariaInvalid,
  "aria-describedby": ariaDescribedBy,
  required,
}: {
  options: Option[];
  noun: string;
  value: string;
  onChange: (code: string) => void;
  /** Match and show the code, such as a state code. */
  showCode?: boolean;
  placeholder?: string;
  inputRef?: Ref<HTMLInputElement>;
  id?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
  required?: boolean;
}) {
  return (
    <LinkField
      items={options}
      query={READY}
      noun={noun}
      getKey={getKey}
      getLabel={getLabel}
      getCode={showCode ? getKey : undefined}
      value={options.find((option) => option.code === value) ?? null}
      onSelect={(option) => onChange(option?.code ?? "")}
      placeholder={placeholder}
      inputRef={inputRef}
      id={id}
      aria-invalid={ariaInvalid}
      aria-describedby={ariaDescribedBy}
      aria-required={required}
    />
  );
}

/** India's states and union territories, labelled by name and matched by code. */
export const STATE_OPTIONS: Option[] = Object.entries(INDIAN_STATES).map(([code, name]) => ({
  code,
  name,
}));

/** Calendar months by number, for the fiscal year start. */
export const MONTH_OPTIONS: Option[] = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
].map((name, index) => ({ code: String(index + 1), name }));

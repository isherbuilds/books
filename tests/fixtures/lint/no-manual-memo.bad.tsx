import * as React from "react";
import { useMemo } from "react";

export function Names({ names }: { names: string[] }) {
  const sorted = useMemo(() => names.toSorted(), [names]);
  const joined = React.useCallback(() => sorted.join(", "), [sorted]);
  return <span>{joined()}</span>;
}

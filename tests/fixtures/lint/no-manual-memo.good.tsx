import * as React from "react";

export function Names({ names }: { names: string[] }) {
  const [open] = React.useState(false);
  return <span>{open ? names.toSorted().join(", ") : null}</span>;
}

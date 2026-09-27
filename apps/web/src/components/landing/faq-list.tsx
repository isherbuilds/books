import type { ReactNode } from "react";

/* Native <details>: keyboard and screen-reader correct with no script, and
   every answer stays in the page for search and print. */
export function FaqList({ items }: { items: readonly { q: string; a: ReactNode }[] }) {
  return (
    <div className="faq">
      {items.map((item) => (
        <details key={item.q}>
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  );
}

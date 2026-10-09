import { Link } from "@tanstack/react-router";

export function Pdf({ orgSlug, invoiceId }: { orgSlug: string; invoiceId: string }) {
  return (
    <Link to="/api/$orgSlug/invoices/$invoiceId/pdf" params={{ orgSlug, invoiceId }}>
      PDF
    </Link>
  );
}

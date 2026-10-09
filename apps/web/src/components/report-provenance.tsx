import { formatBusinessDate } from "@accly/api/lib/business-date";
import type { ReportHeader } from "@accly/api/lib/reports";

import { formatDateTime } from "@/lib/org-datetime";

export function ReportProvenance({ header }: { header: ReportHeader }) {
  const range = header.range;

  return (
    <div className="text-sm">
      <p className="text-xl font-medium">{header.organization.legalName}</p>
      {header.organization.gstin ? (
        <p className="text-muted-foreground">GSTIN {header.organization.gstin}</p>
      ) : null}
      <p>
        {"asOf" in range
          ? `As of ${formatBusinessDate(range.asOf)}`
          : `${formatBusinessDate(range.from)} – ${formatBusinessDate(range.to)}`}
      </p>
      <p className="text-muted-foreground">
        Generated {formatDateTime(header.generatedAt, header.timeZone)}
      </p>
    </div>
  );
}

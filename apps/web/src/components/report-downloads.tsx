import { Button } from "@accly/ui/components/button";
import { useMutation } from "@tanstack/react-query";
import { Link, type LinkOptions } from "@tanstack/react-router";
import { DownloadIcon } from "lucide-react";
import { toast } from "sonner";

import { useCan } from "@/lib/membership";
import { errorMessage } from "@/lib/orpc-error";
import { saveFile } from "@/lib/reports";

/**
 * A report's XLSX and PDF buttons. Until the report's inputs are complete (`ready`),
 * XLSX is disabled and PDF is hidden. XLSX needs the export grant.
 */
export function ReportDownloads({
  orgSlug,
  ready = true,
  build,
  failure,
  pdf,
}: {
  orgSlug: string;
  ready?: boolean;
  build: () => Promise<File>;
  failure: string;
  pdf: LinkOptions;
}) {
  const canExport = useCan(orgSlug, { export: ["read"] });

  const download = useMutation({
    mutationFn: build,
    onSuccess: saveFile,
    // oxlint-disable-next-line accly/write-errors-via-handler -- an export download reads; it writes nothing
    onError: (error) => toast.error(errorMessage(error, failure)),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      {canExport ? (
        <Button
          variant="outline"
          disabled={!ready || download.isPending}
          onClick={() => download.mutate()}
        >
          <DownloadIcon data-icon="inline-start" />
          {download.isPending ? "Building…" : "Download XLSX"}
        </Button>
      ) : null}
      {ready ? (
        <Button
          render={<Link {...pdf} reloadDocument target="_blank" rel="noopener noreferrer" />}
          nativeButton={false}
          variant="outline"
        >
          <DownloadIcon data-icon="inline-start" />
          Download PDF
        </Button>
      ) : null}
    </div>
  );
}

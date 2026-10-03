import { formatMoney } from "@accly/api/core/money";
import { FILE_TOO_LARGE_MESSAGE, MAX_IMPORT_FILE_BYTES } from "@accly/api/lib/import-limits";
import type { AppRouterClient } from "@accly/api/routers/index";
import { IMPORT_GRANT } from "@accly/auth/access";
import { Button } from "@accly/ui/components/button";
import { Input } from "@accly/ui/components/input";
import { Label } from "@accly/ui/components/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@accly/ui/components/table";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useConfirm } from "@/components/confirm-dialog";
import { DetailRow } from "@/components/detail-row";
import { PageBody, PageHeader, Panel } from "@/components/page";
import { invalidateImportState } from "@/lib/domain-invalidation";
import { orpc } from "@/lib/orpc";
import { errorMessage, handleWriteError } from "@/lib/orpc-error";
import { saveFile } from "@/lib/reports";
import { requireOrgPermission } from "@/lib/route-permission";

import { SettingsTabs } from "./route";

type ImportResult =
  | { kind: "checked"; result: Awaited<ReturnType<AppRouterClient["import"]["check"]>> }
  | { kind: "imported"; result: Awaited<ReturnType<AppRouterClient["import"]["commit"]>> };

export const Route = createFileRoute("/$orgSlug/settings/import")({
  head: () => ({ meta: [{ title: "Import · Accly Books" }] }),
  loader: async ({ context: { queryClient }, params: { orgSlug } }) => {
    await requireOrgPermission(queryClient, orgSlug, IMPORT_GRANT);
  },
  component: ImportRoute,
});

function ImportRoute() {
  const { orgSlug } = Route.useParams();
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [confirm, confirmDialog] = useConfirm();

  // A file chosen before hydration fired its change event before React listened.
  useEffect(() => {
    setFile(inputRef.current?.files?.[0] ?? null);
  }, []);

  const template = useMutation({
    mutationFn: () => orpc.import.template.call({ orgSlug }),
    onSuccess: saveFile,
    onError: (error) => toast.error(errorMessage(error, "Could not download the template")),
  });

  const check = useMutation({
    mutationFn: (chosen: File) => orpc.import.check.call({ orgSlug, file: chosen }),
    onMutate: () => setResult(null),
    onSuccess: (checked) => setResult({ kind: "checked", result: checked }),
    onError: (error) => toast.error(errorMessage(error, "Could not check the workbook")),
  });

  const commit = useMutation({
    mutationFn: (chosen: File) => orpc.import.commit.call({ orgSlug, file: chosen }),
    onMutate: () => setResult(null),
    onSuccess: async (imported) => {
      setResult({ kind: "imported", result: imported });
      toast.success("Workbook imported");
      await invalidateImportState(queryClient, orgSlug);
    },
    onError: (error) =>
      handleWriteError(error, {
        settle: () => invalidateImportState(queryClient, orgSlug),
        fallback: "Could not import the workbook",
        uncertain:
          "Could not confirm the import. Check Opening balance and Parties before trying again.",
      }),
  });

  const pending = template.isPending || check.isPending || commit.isPending;

  // Choosing or clearing a file clears the result, so a result is always this file's.
  const canImport = result?.kind === "checked" && result.result.errorCount === 0;
  const errors = result?.kind === "checked" && result.result.errorCount > 0 ? result.result : null;
  const summary = errors ? null : result?.result.summary;

  return (
    <>
      <PageHeader
        title="Import"
        description="Bring in masters and opening balances from an Excel workbook."
        action={
          <Button variant="outline" disabled={pending} onClick={() => template.mutate()}>
            {template.isPending ? "Downloading…" : "Download template"}
          </Button>
        }
      />
      <SettingsTabs orgSlug={orgSlug} />
      <PageBody>
        <div className="flex min-w-0 max-w-xl flex-col gap-3" aria-busy={pending}>
          <div className="flex min-w-0 flex-col gap-2">
            <Label htmlFor="import-workbook">Excel workbook</Label>
            <Input
              ref={inputRef}
              id="import-workbook"
              type="file"
              accept=".xlsx"
              disabled={pending}
              aria-describedby="import-workbook-help"
              onChange={(event) => {
                setFile(event.currentTarget.files?.[0] ?? null);
                setResult(null);
              }}
            />
            <p id="import-workbook-help" className="text-muted-foreground">
              Fill in the template, then check it before importing. Nothing is saved by Check.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={pending || !file}
              onClick={() => file && upload(file, (copy) => check.mutate(copy))}
            >
              {check.isPending ? "Checking…" : "Check"}
            </Button>
            <Button
              disabled={pending || !canImport}
              onClick={() => {
                if (!file || !canImport) return;

                confirm({
                  title: "Import workbook?",
                  description:
                    "This creates the workbook’s masters and posts any opening balances. Imported masters cannot be deleted.",
                  confirmLabel: "Import workbook",
                  run: () => upload(file, (copy) => commit.mutate(copy)),
                });
              }}
            >
              {commit.isPending ? "Importing…" : "Import"}
            </Button>
            <Button
              variant="ghost"
              disabled={pending || !file}
              onClick={() => {
                if (inputRef.current) inputRef.current.value = "";
                setFile(null);
                setResult(null);
              }}
            >
              Clear
            </Button>
          </div>
        </div>

        {errors ? (
          <Panel label="Workbook errors">
            <p role="status" className="px-3 py-2 text-muted-foreground tabular-nums">
              {errors.errorCount > errors.errors.length
                ? `Showing ${errors.errors.length.toLocaleString("en-IN")} of ${errors.errorCount.toLocaleString("en-IN")} errors`
                : `${errors.errorCount.toLocaleString("en-IN")} ${errors.errorCount === 1 ? "error" : "errors"}`}
              . Fix the workbook and check it again.
            </p>
            <Table className="min-w-xl" aria-label="Workbook errors">
              <TableHeader>
                <TableRow>
                  <TableHead scope="col">Sheet</TableHead>
                  <TableHead scope="col">Row</TableHead>
                  <TableHead scope="col">Column</TableHead>
                  <TableHead scope="col">Message</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {errors.errors.map((error, index) => (
                  <TableRow
                    key={`${error.sheet}:${error.row}:${error.column}:${error.code}:${index}`}
                  >
                    <TableCell className="whitespace-nowrap">{error.sheet ?? "—"}</TableCell>
                    <TableCell>{error.row ?? "—"}</TableCell>
                    <TableCell>{error.column ?? "—"}</TableCell>
                    <TableCell className="whitespace-normal wrap-anywhere">
                      {error.message}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Panel>
        ) : null}

        {summary ? (
          <section className="flex min-w-0 max-w-2xl flex-col gap-3">
            <h2 role="status" className="text-base font-medium">
              {result?.kind === "imported" ? "Import complete" : "Ready to import"}
            </h2>
            <dl className="grid gap-x-6 gap-y-2 tabular-nums sm:grid-cols-2">
              <DetailRow label="Accounts">{summary.accounts.toLocaleString("en-IN")}</DetailRow>
              <DetailRow label="Parties">{summary.parties.toLocaleString("en-IN")}</DetailRow>
              <DetailRow label="Items">{summary.items.toLocaleString("en-IN")}</DetailRow>
              <DetailRow label="Trial balance rows">
                {summary.trialBalanceRows.toLocaleString("en-IN")}
              </DetailRow>
              <DetailRow label="Opening claims">
                {summary.openingClaims.toLocaleString("en-IN")}
              </DetailRow>
              <DetailRow label="Opening credits">
                {summary.openingCredits.toLocaleString("en-IN")}
              </DetailRow>
              <DetailRow label="Trial balance debit">{formatMoney(summary.debitPaise)}</DetailRow>
              <DetailRow label="Trial balance credit">{formatMoney(summary.creditPaise)}</DetailRow>
              <DetailRow label="Receivables net">{formatMoney(summary.receivablesPaise)}</DetailRow>
              <DetailRow label="Payables net">{formatMoney(summary.payablesPaise)}</DetailRow>
            </dl>
            {result?.kind === "imported" ? (
              <div className="flex flex-wrap gap-3">
                <Link
                  to="/$orgSlug/settings/opening-balance"
                  params={{ orgSlug }}
                  className="underline underline-offset-4"
                >
                  Opening balance
                </Link>
                <Link
                  to="/$orgSlug/parties"
                  params={{ orgSlug }}
                  className="underline underline-offset-4"
                >
                  Parties
                </Link>
              </div>
            ) : null}
          </section>
        ) : null}
      </PageBody>
      {confirmDialog}
    </>
  );
}

/**
 * Reads the chosen file into memory before sending it. Above the server's body limit
 * an upload fails before oRPC can explain why, and Chrome refuses a file edited on
 * disk after it was chosen; both read as plain messages here instead.
 */
function upload(file: File, send: (copy: File) => void): void {
  if (file.size > MAX_IMPORT_FILE_BYTES) {
    toast.error(FILE_TOO_LARGE_MESSAGE);

    return;
  }

  file.arrayBuffer().then(
    (bytes) => send(new File([bytes], file.name, { type: file.type })),
    () => toast.error("The workbook changed after you chose it. Choose it again."),
  );
}

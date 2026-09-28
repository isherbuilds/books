import { formatBalance } from "@accly/api/core/money";

export function formatSideBalance(debitPaise: bigint, creditPaise: bigint): string {
  return formatBalance(debitPaise - creditPaise);
}

// The server returns the workbook as a File; a detached anchor saves it under the
// name the server chose. The object URL is released after the download has started.
export function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

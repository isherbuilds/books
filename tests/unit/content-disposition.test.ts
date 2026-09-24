import { expect, test } from "bun:test";

import { contentDisposition } from "@accly/storage/content-disposition";

test("builds a valid content disposition for hostile and Unicode file names", () => {
  const header = contentDisposition("attachment", 'RCT-\r\n"कविता.pdf', "document.pdf");

  expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
  expect(header).toBe(
    "attachment; filename=\"document.pdf\"; filename*=UTF-8''RCT-__%22%E0%A4%95%E0%A4%B5%E0%A4%BF%E0%A4%A4%E0%A4%BE.pdf",
  );
});

test("sanitizes an arbitrary ASCII fallback before quoting it", () => {
  const header = contentDisposition("inline", "report.pdf", 'bad"\\\r\nह.pdf');

  expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
  expect(header).toContain('inline; filename="bad_____.pdf";');
});

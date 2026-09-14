import { expect, test } from "bun:test";

import { pdfContentDisposition } from "../../apps/web/src/lib/content-disposition";

test("builds a valid content disposition for hostile and Unicode file names", () => {
  const header = pdfContentDisposition('RCT-\r\n"कविता.pdf', true);

  expect(() => new Headers({ "Content-Disposition": header })).not.toThrow();
  expect(header).toBe(
    "attachment; filename=\"document.pdf\"; filename*=UTF-8''RCT-__%22%E0%A4%95%E0%A4%B5%E0%A4%BF%E0%A4%A4%E0%A4%BE.pdf",
  );
});

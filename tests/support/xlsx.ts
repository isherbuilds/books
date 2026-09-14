import { inflateRawSync } from "node:zlib";

/** The decoded XML text of one entry in an XLSX (ZIP) file. */
export function readZipText(bytes: Uint8Array, name: string): string {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = bytes.length - 22;

  while (eocd >= 0 && view.getUint32(eocd, true) !== 0x06054b50) eocd--;

  if (eocd < 0) throw new Error("ZIP end-of-central-directory record not found");

  let cursor = view.getUint32(eocd + 16, true);
  const entries = view.getUint16(eocd + 10, true);

  for (let index = 0; index < entries; index++) {
    if (view.getUint32(cursor, true) !== 0x02014b50) throw new Error("Invalid ZIP directory");
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);

    const entryName = new TextDecoder().decode(
      bytes.subarray(cursor + 46, cursor + 46 + nameLength),
    );

    if (entryName === name) {
      const localOffset = view.getUint32(cursor + 42, true);
      const localNameLength = view.getUint16(localOffset + 26, true);
      const localExtraLength = view.getUint16(localOffset + 28, true);
      const dataOffset = localOffset + 30 + localNameLength + localExtraLength;
      const compressedSize = view.getUint32(cursor + 20, true);
      const compressed = bytes.subarray(dataOffset, dataOffset + compressedSize);
      const method = view.getUint16(cursor + 10, true);

      if (method === 0) return new TextDecoder().decode(compressed);

      if (method === 8) return new TextDecoder().decode(inflateRawSync(compressed));
      throw new Error(`Unsupported ZIP compression method ${method}`);
    }

    cursor += 46 + nameLength + extraLength + commentLength;
  }

  throw new Error(`ZIP entry not found: ${name}`);
}

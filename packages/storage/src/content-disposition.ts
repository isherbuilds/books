function encode5987(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

/**
 * A fixed ASCII fallback plus RFC 5987 keeps arbitrary stored names header-safe.
 * Dependency-free, so the web server imports it without the S3 client.
 */
export function contentDisposition(
  disposition: "inline" | "attachment",
  fileName: string,
  asciiFallback: string,
): string {
  const safeFileName = Array.from(fileName, (character) => {
    const codePoint = character.codePointAt(0)!;

    return codePoint <= 31 || codePoint === 127 ? "_" : character;
  }).join("");

  return `${disposition}; filename="${asciiFallback}"; filename*=UTF-8''${encode5987(safeFileName)}`;
}

/* The Edernal Books wordmark, carbon on light and porcelain on dark. Both
   images are in the markup and the theme class picks one, so the server render
   never depends on the resolved theme. Lazy, so the hidden one is never
   fetched. */
export function Wordmark({ className = "" }: { className?: string }) {
  return (
    <>
      <img
        src="/brand/edernal-books-wordmark-carbon.svg"
        alt="Edernal Books"
        width={6771}
        height={732}
        loading="lazy"
        className={`h-auto dark:hidden ${className}`}
      />
      <img
        src="/brand/edernal-books-wordmark-porcelain.svg"
        alt="Edernal Books"
        width={6771}
        height={732}
        loading="lazy"
        className={`hidden h-auto dark:block ${className}`}
      />
    </>
  );
}

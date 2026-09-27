import type { CSSProperties } from "react";

/* A placeholder cut-out where a real photo of a person goes. The sticker edge
   is `.sticker` in marketing.css; width, tilt and skin/cloth/hair tones are
   optional, and a CSS class may set `--w` instead for responsive sizes. */
export function Person({
  label,
  width,
  tilt,
  tones,
  className = "",
}: {
  label: string;
  width?: number;
  tilt?: number;
  tones?: readonly [string, string, string];
  className?: string;
}) {
  // SAFETY: React sets custom properties from `style`; CSSProperties only lacks their keys.
  const style = {
    "--w": width && `${width}px`,
    "--r": tilt && `${tilt}deg`,
    "--p1": tones?.[0],
    "--p2": tones?.[1],
    "--p3": tones?.[2],
  } as CSSProperties;

  return (
    <span role="img" aria-label={label} className={`sticker ${className}`} style={style}>
      <svg viewBox="0 0 200 240" className="block size-full">
        <path fill="var(--p1)" d="M16 240c2-58 36-96 84-96s82 38 84 96z" />
        <rect fill="var(--p2)" x="82" y="112" width="36" height="44" rx="14" />
        <ellipse fill="var(--p2)" cx="100" cy="80" rx="43" ry="51" />
        <path
          fill="var(--p3)"
          d="M56 78c-2-36 18-58 45-58 28 0 47 21 44 56-9-16-27-25-46-25-19 0-34 10-43 27z"
        />
      </svg>
    </span>
  );
}

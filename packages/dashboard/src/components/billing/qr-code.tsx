"use client";

import { useMemo } from "react";
import { encode } from "uqr";

/**
 * A QR code drawn as one SVG path from the module matrix, so no HTML string is injected. Dark
 * modules on a white card whatever the theme: wallet cameras read dark-on-light far better.
 */
export function QrCode({
  value,
  label,
  size = 208,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const { path, modules } = useMemo(() => {
    const { data, size: n } = encode(value, { ecc: "M", border: 2 });
    let d = "";
    data.forEach((row, y) => {
      row.forEach((dark, x) => {
        if (dark) d += `M${x} ${y}h1v1h-1z`;
      });
    });
    return { path: d, modules: n };
  }, [value]);

  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${modules} ${modules}`}
      width={size}
      height={size}
      shapeRendering="crispEdges"
      className="rounded-lg bg-white"
    >
      <path d={path} fill="#000" />
    </svg>
  );
}

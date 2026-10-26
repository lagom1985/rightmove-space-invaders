// WCAG 2.x relative luminance and contrast ratio, for the backdrop legibility rule (ADR-011). Test-only: nothing in
// production computes contrast. The sRGB threshold is 0.04045 (IEC 61966-2-1); WCAG 2.x prints 0.03928, and no 8-bit
// channel value lies between the two, so both give the same result for every #rrggbb colour.

const channel = value => {
  const c = value / 255;
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
};

// '#rrggbb' -> 0 (black) to 1 (white).
export function relativeLuminance(hex) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`not a #rrggbb colour: ${hex}`);
  const n = parseInt(match[1], 16);
  return 0.2126 * channel((n >> 16) & 255) + 0.7152 * channel((n >> 8) & 255) + 0.0722 * channel(n & 255);
}

// Two relative luminances, in either order -> their contrast ratio, 1 to 21.
export const contrastRatio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

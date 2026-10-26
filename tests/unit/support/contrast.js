// WCAG 2.2's relative luminance and contrast ratio (ADR-011), for the legibility checks on theme data. Nothing in
// production computes contrast. https://www.w3.org/TR/WCAG22/#dfn-relative-luminance

const linear = byte => { const c = byte / 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };

// '#rrggbb' -> 0 for black up to 1 for white.
export function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map(i => linear(parseInt(hex.slice(i, i + 2), 16)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

// Two luminances -> their contrast ratio, from 1 (1:1) up to 21 (21:1), whichever way round they are given.
export function contrastRatio(a, b) {
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

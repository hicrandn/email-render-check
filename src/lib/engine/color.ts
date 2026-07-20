// Pure color math for dark-mode simulation. No DOM.
//
// Auto-inverting clients (Gmail, Yahoo) do NOT do a naive `255 - x` per channel:
// that destroys brand hues. They mostly flip *lightness* while preserving hue
// and saturation, so we model inversion as an HSL lightness flip (L -> 1 - L).
// WCAG relative-luminance + contrast ratio let us flag pairs that become
// unreadable after inversion.

export interface Rgba {
  r: number; // 0..255
  g: number; // 0..255
  b: number; // 0..255
  a: number; // 0..1
}

// A compact set of CSS named colors (covers the ones real emails use).
const NAMED: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  white: [255, 255, 255],
  red: [255, 0, 0],
  green: [0, 128, 0],
  blue: [0, 0, 255],
  gray: [128, 128, 128],
  grey: [128, 128, 128],
  silver: [192, 192, 192],
  maroon: [128, 0, 0],
  yellow: [255, 255, 0],
  olive: [128, 128, 0],
  lime: [0, 255, 0],
  aqua: [0, 255, 255],
  cyan: [0, 255, 255],
  teal: [0, 128, 128],
  navy: [0, 0, 128],
  fuchsia: [255, 0, 255],
  magenta: [255, 0, 255],
  purple: [128, 0, 128],
  orange: [255, 165, 0],
};

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hex2 = (n: number) => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0');

/** Parse a CSS color into RGBA, or null if unrecognized / non-literal. */
export function parseColor(input: string): Rgba | null {
  const s = input.trim().toLowerCase();
  if (s === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };

  if (s.startsWith('#')) {
    const h = s.slice(1);
    if (h.length === 3 || h.length === 4) {
      const r = parseInt(h[0] + h[0], 16);
      const g = parseInt(h[1] + h[1], 16);
      const b = parseInt(h[2] + h[2], 16);
      const a = h.length === 4 ? parseInt(h[3] + h[3], 16) / 255 : 1;
      return [r, g, b].some(Number.isNaN) ? null : { r, g, b, a };
    }
    if (h.length === 6 || h.length === 8) {
      const r = parseInt(h.slice(0, 2), 16);
      const g = parseInt(h.slice(2, 4), 16);
      const b = parseInt(h.slice(4, 6), 16);
      const a = h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1;
      return [r, g, b].some(Number.isNaN) ? null : { r, g, b, a };
    }
    return null;
  }

  const fn = /^(rgba?|hsla?)\(([^)]+)\)$/.exec(s);
  if (fn) {
    const kind = fn[1];
    const parts = fn[2].split(/[,/\s]+/).filter(Boolean);
    if (kind.startsWith('rgb')) {
      const r = parseChannel(parts[0], 255);
      const g = parseChannel(parts[1], 255);
      const b = parseChannel(parts[2], 255);
      const a = parts[3] !== undefined ? parseAlpha(parts[3]) : 1;
      return [r, g, b].some(Number.isNaN) ? null : { r, g, b, a };
    }
    // hsl / hsla
    const h = parseFloat(parts[0]);
    const sat = parseFloat(parts[1]) / 100;
    const l = parseFloat(parts[2]) / 100;
    const a = parts[3] !== undefined ? parseAlpha(parts[3]) : 1;
    if ([h, sat, l].some(Number.isNaN)) return null;
    const rgb = hslToRgb({ h, s: sat, l });
    return { ...rgb, a };
  }

  const named = NAMED[s];
  return named ? { r: named[0], g: named[1], b: named[2], a: 1 } : null;
}

function parseChannel(tok: string | undefined, max: number): number {
  if (tok === undefined) return NaN;
  return tok.endsWith('%') ? (parseFloat(tok) / 100) * max : parseFloat(tok);
}
function parseAlpha(tok: string): number {
  return clamp(tok.endsWith('%') ? parseFloat(tok) / 100 : parseFloat(tok), 0, 1);
}

/** Serialize back to `#rrggbb` (opaque) or `rgba(...)` (translucent). */
export function formatColor(c: Rgba): string {
  if (c.a >= 1) return `#${hex2(c.r)}${hex2(c.g)}${hex2(c.b)}`;
  const a = Math.round(c.a * 1000) / 1000;
  return `rgba(${clamp(Math.round(c.r), 0, 255)}, ${clamp(Math.round(c.g), 0, 255)}, ${clamp(Math.round(c.b), 0, 255)}, ${a})`;
}

export interface Hsl {
  h: number; // 0..360
  s: number; // 0..1
  l: number; // 0..1
}

export function rgbToHsl({ r, g, b }: { r: number; g: number; b: number }): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  let h = 0;
  let s = 0;
  const d = max - min;
  if (d !== 0) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case rn:
        h = ((gn - bn) / d + (gn < bn ? 6 : 0)) * 60;
        break;
      case gn:
        h = ((bn - rn) / d + 2) * 60;
        break;
      default:
        h = ((rn - gn) / d + 4) * 60;
    }
  }
  return { h, s, l };
}

export function hslToRgb({ h, s, l }: Hsl): { r: number; g: number; b: number } {
  const hn = ((h % 360) + 360) % 360 / 360;
  if (s === 0) {
    const v = Math.round(l * 255);
    return { r: v, g: v, b: v };
  }
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const toChannel = (t: number) => {
    let tn = t;
    if (tn < 0) tn += 1;
    if (tn > 1) tn -= 1;
    if (tn < 1 / 6) return p + (q - p) * 6 * tn;
    if (tn < 1 / 2) return q;
    if (tn < 2 / 3) return p + (q - p) * (2 / 3 - tn) * 6;
    return p;
  };
  return {
    r: Math.round(toChannel(hn + 1 / 3) * 255),
    g: Math.round(toChannel(hn) * 255),
    b: Math.round(toChannel(hn - 1 / 3) * 255),
  };
}

/**
 * Approximate a client's auto-inversion: flip HSL lightness, keep hue +
 * saturation, preserve alpha. Returns null for colors we can't parse.
 */
export function flipLightness(input: string): string | null {
  const rgba = parseColor(input);
  if (!rgba) return null;
  const hsl = rgbToHsl(rgba);
  const flipped = hslToRgb({ ...hsl, l: 1 - hsl.l });
  return formatColor({ ...flipped, a: rgba.a });
}

/** WCAG relative luminance of an (opaque) color. */
export function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const lin = (c: number) => {
    const cs = c / 255;
    return cs <= 0.03928 ? cs / 12.92 : Math.pow((cs + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG contrast ratio between two colors (1..21). */
export function contrastRatio(a: Rgba, b: Rgba): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

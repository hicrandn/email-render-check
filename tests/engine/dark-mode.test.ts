import { describe, it, expect } from 'vitest';
import { simulate } from '@/src/lib/engine/engine';
import { DEFAULT_CONTEXT, type Mutation, type RenderContext } from '@/src/lib/engine/types';
import { parseColor, rgbToHsl, flipLightness } from '@/src/lib/engine/color';

const DARK: RenderContext = { colorScheme: 'dark', viewportWidth: 375 };
const byFeature = (m: Mutation[], f: string) => m.filter((x) => x.feature === f);

describe('color: HSL lightness-flip inversion', () => {
  it('flips white to black and black to white', () => {
    expect(flipLightness('#ffffff')).toBe('#000000');
    expect(flipLightness('#000000')).toBe('#ffffff');
  });

  it('preserves hue and saturation, flipping only lightness', () => {
    const before = rgbToHsl(parseColor('#2563eb')!);
    const after = rgbToHsl(parseColor(flipLightness('#2563eb')!)!);
    expect(Math.abs(after.h - before.h)).toBeLessThan(2); // hue preserved
    expect(Math.abs(after.s - before.s)).toBeLessThan(0.05); // saturation preserved
    expect(Math.abs(after.l - (1 - before.l))).toBeLessThan(0.02); // lightness flipped
  });
});

describe('dark mode: outlook-win (unsupported)', () => {
  it('emits one "rendered light" info and no color mutations', () => {
    const html = '<div style="background-color:#ffffff;color:#111111">Hi</div>';
    const { mutations } = simulate(html, 'outlook-win', DARK);
    expect(byFeature(mutations, 'darkmode-unsupported')).toHaveLength(1);
    expect(byFeature(mutations, 'darkmode-unsupported')[0].severity).toBe('info');
    expect(mutations.filter((m) => m.action === 'auto-invert-color')).toHaveLength(0);
  });
});

describe('dark mode: gmail (auto-invert) with NO author dark CSS', () => {
  const html =
    '<div style="background-color:#ffffff">' +
    '<a style="background-color:#2563eb;color:#ffffff">Button</a>' +
    '</div>';

  it('produces auto-invert-color mutations', () => {
    const { mutations } = simulate(html, 'gmail', DARK);
    expect(byFeature(mutations, 'darkmode-auto-invert').length).toBeGreaterThan(0);
    expect(byFeature(mutations, 'darkmode-auto-invert')[0].severity).toBe('warning');
  });

  it('turns a white background near-black in the output', () => {
    const { html: out } = simulate(html, 'gmail', DARK);
    expect(out).toContain('#000000');
  });

  it('roughly preserves the hue of a colored button (L flips, H kept)', () => {
    const { html: out } = simulate(html, 'gmail', DARK);
    const flipped = flipLightness('#2563eb')!;
    expect(out).toContain(flipped);
    const before = rgbToHsl(parseColor('#2563eb')!);
    const after = rgbToHsl(parseColor(flipped)!);
    expect(Math.abs(after.h - before.h)).toBeLessThan(2);
    expect(after.l).toBeLessThan(before.l + 0.5); // lightness moved, not identity
  });
});

describe('dark mode: gmail with an author prefers-color-scheme block', () => {
  const html = `<html><head><style>
    .btn { background-color:#2563eb; }
    @media (prefers-color-scheme: dark) {
      .btn { background-color:#0b1a3a; color:#e6e6ea; }
    }
  </style></head><body><a class="btn">Go</a></body></html>`;

  // caniemail: Gmail and Yahoo do not support prefers-color-scheme.
  it.each(['gmail', 'yahoo'] as const)('%s drops the dark block and auto-inverts', (client) => {
    const { mutations, html: out } = simulate(html, client, DARK);
    const stripped = byFeature(mutations, 'css-at-media-prefers-color-scheme');
    expect(stripped).toHaveLength(1);
    expect(stripped[0].action).toBe('remove-rule');
    expect(byFeature(mutations, 'darkmode-author-override')).toHaveLength(0);
    expect(byFeature(mutations, 'darkmode-auto-invert').length).toBeGreaterThan(0);
    expect(out).not.toContain('#0b1a3a');
  });
});

describe('dark mode: outlook-com (partial)', () => {
  it('applies author dark media queries', () => {
    const html = `<style>@media (prefers-color-scheme: dark) { p { color:#eeeeee; } }</style><p>x</p>`;
    const { mutations, html: out } = simulate(html, 'outlook-com', DARK);
    expect(byFeature(mutations, 'darkmode-author-override').length).toBeGreaterThan(0);
    expect(out).not.toContain('@media');
  });

  it('marks <body> with data-ogsc so [data-ogsc] rules match', () => {
    const html = `<style>[data-ogsc] .t { color:#ffffff; }</style><p class="t">x</p>`;
    const { mutations, html: out } = simulate(html, 'outlook-com', DARK);
    expect(byFeature(mutations, 'darkmode-ogsc-applied')).toHaveLength(1);
    expect(out).toMatch(/<body[^>]*data-ogsc/);
  });

  it('does not claim to honor the color-scheme meta', () => {
    const html = '<meta name="color-scheme" content="light dark"><p>x</p>';
    const { mutations } = simulate(html, 'outlook-com', DARK);
    expect(byFeature(mutations, 'darkmode-meta-only')).toHaveLength(0);
    expect(byFeature(mutations, 'darkmode-keeps-light')).toHaveLength(1);
  });
});

describe('dark mode: gmail ignores [data-ogsc]', () => {
  it('still auto-inverts', () => {
    const html = `<style>[data-ogsc] .t { color:#ffffff; }</style><p class="t" style="color:#111111">x</p>`;
    const { mutations } = simulate(html, 'gmail', DARK);
    expect(byFeature(mutations, 'darkmode-ogsc-applied')).toHaveLength(0);
    expect(byFeature(mutations, 'darkmode-auto-invert').length).toBeGreaterThan(0);
  });
});

describe('dark mode: apple-mail (native)', () => {
  it('applies author dark media query when present', () => {
    const html = `<html><head><style>
      @media (prefers-color-scheme: dark) { body { background:#111111; } }
    </style></head><body>x</body></html>`;
    const { mutations } = simulate(html, 'apple-mail', DARK);
    expect(byFeature(mutations, 'darkmode-author-override').length).toBeGreaterThan(0);
    expect(byFeature(mutations, 'darkmode-auto-invert')).toHaveLength(0);
  });

  it('keeps the light design (no inversion) when no dark styles exist', () => {
    const html = '<div style="background-color:#ffffff;color:#111111">Hello</div>';
    const { mutations } = simulate(html, 'apple-mail', DARK);
    expect(byFeature(mutations, 'darkmode-keeps-light')).toHaveLength(1);
    expect(mutations.filter((m) => m.action === 'auto-invert-color')).toHaveLength(0);
  });
});

describe('dark mode: contrast regression', () => {
  it('flags a white card with default (undeclared) text going unreadable', () => {
    // Gmail flips the white background to black; the undeclared black text vanishes.
    const html = '<div style="background-color:#ffffff">Important message</div>';
    const { mutations } = simulate(html, 'gmail', DARK);
    const contrast = byFeature(mutations, 'darkmode-contrast');
    expect(contrast).toHaveLength(1);
    expect(contrast[0].severity).toBe('error');
  });

  it('does not flag contrast for an empty (text-free) element', () => {
    const html = '<div style="background-color:#ffffff"><img src="x.png"></div>';
    const { mutations } = simulate(html, 'gmail', DARK);
    expect(byFeature(mutations, 'darkmode-contrast')).toHaveLength(0);
  });
});

describe('dark mode: image inversion warning', () => {
  it('warns once about images when inversion happens', () => {
    const html = '<div style="background-color:#ffffff"><img src="logo.png" alt="logo"></div>';
    const { mutations } = simulate(html, 'gmail', DARK);
    expect(byFeature(mutations, 'darkmode-image-inversion')).toHaveLength(1);
    expect(byFeature(mutations, 'darkmode-image-inversion')[0].severity).toBe('error');
  });
});

describe('dark mode: light context is a no-op', () => {
  it('produces no dark-mode mutations under the default (light) context', () => {
    const html = '<div style="background-color:#ffffff;color:#111111">Hi</div>';
    const { mutations } = simulate(html, 'gmail', DEFAULT_CONTEXT);
    expect(mutations.filter((m) => m.stage === 'dark-mode')).toHaveLength(0);
  });
});

describe('dark mode: determinism', () => {
  it('same (html, client, dark ctx) yields byte-identical output three times', () => {
    const html =
      '<div style="background-color:#ffffff"><p style="color:#333333">Body</p></div>';
    const a = simulate(html, 'gmail', DARK);
    const b = simulate(html, 'gmail', DARK);
    const c = simulate(html, 'gmail', DARK);
    expect(a.html).toBe(b.html);
    expect(b.html).toBe(c.html);
    expect(JSON.stringify(a.mutations)).toBe(JSON.stringify(c.mutations));
  });
});

describe('quirks: Outlook percentage width + block margin', () => {
  it('warns on percentage width for outlook-win', () => {
    const { mutations } = simulate('<table style="width:100%"><tr><td>x</td></tr></table>', 'outlook-win');
    expect(byFeature(mutations, 'quirk-outlook-width')).toHaveLength(1);
  });

  it('warns on margin on a block element for outlook-win', () => {
    const { mutations } = simulate('<div style="margin:20px">x</div>', 'outlook-win');
    const m = byFeature(mutations, 'quirk-outlook-margin');
    expect(m.length).toBeGreaterThanOrEqual(1);
    expect(m[0].severity).toBe('warning');
  });

  it('does not flag margin:0 or non-outlook clients', () => {
    expect(byFeature(simulate('<div style="margin:0">x</div>', 'outlook-win').mutations, 'quirk-outlook-margin')).toHaveLength(0);
    expect(byFeature(simulate('<div style="margin:20px">x</div>', 'gmail').mutations, 'quirk-outlook-margin')).toHaveLength(0);
  });
});

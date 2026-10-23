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

describe('dark mode: Gmail and Yahoo on the web leave colors alone', () => {
  it.each(['gmail', 'yahoo', 'yahoo-mobile'] as const)('%s renders the light design', (client) => {
    const html = '<div style="background-color:#ffffff;color:#111111">Hi</div>';
    const { mutations, html: out } = simulate(html, client, DARK);
    expect(byFeature(mutations, 'darkmode-no-change')).toHaveLength(1);
    expect(byFeature(mutations, 'darkmode-no-change')[0].severity).toBe('info');
    expect(mutations.filter((m) => m.action === 'auto-invert-color')).toHaveLength(0);
    expect(out).toContain('background-color:#ffffff');
    expect(out).toContain('color-scheme:light');
  });
});

describe('dark mode: Outlook on Windows fully inverts', () => {
  it('flips a white background and dark text', () => {
    const html = '<div style="background-color:#ffffff;color:#111111">Hi</div>';
    const { html: out } = simulate(html, 'outlook-win', DARK);
    expect(out).toContain('background-color:#000000');
    expect(out).toContain(`color:${flipLightness('#111111')}`);
  });

  it('recolors HTML color attributes too', () => {
    const html = '<table bgcolor="#ffffff"><tr><td><font color="#000000">x</font></td></tr></table>';
    const { html: out, mutations } = simulate(html, 'outlook-win', DARK);
    expect(out).toContain('bgcolor="#000000"');
    expect(out).toContain('color="#ffffff"');
    expect(byFeature(mutations, 'darkmode-auto-invert').map((m) => m.target.property).sort()).toEqual(['bgcolor', 'color']);
  });

  it('recolors a VML button along with the CSS', () => {
    const html = '<!--[if mso]><v:rect style="width:100px;height:40px" fillcolor="#ffffff" stroked="f">x</v:rect><![endif]-->';
    expect(simulate(html, 'outlook-win', DARK).html).toContain('background-color:#000000');
  });
});

describe('dark mode: the Gmail app (full invert) with NO author dark CSS', () => {
  const html =
    '<div style="background-color:#ffffff">' +
    '<a style="background-color:#2563eb;color:#ffffff">Button</a>' +
    '</div>';

  it('produces auto-invert-color mutations', () => {
    const { mutations } = simulate(html, 'gmail-mobile', DARK);
    expect(byFeature(mutations, 'darkmode-auto-invert').length).toBeGreaterThan(0);
    expect(byFeature(mutations, 'darkmode-auto-invert')[0].severity).toBe('warning');
  });

  it('turns a white background near-black in the output', () => {
    const { html: out } = simulate(html, 'gmail-mobile', DARK);
    expect(out).toContain('#000000');
  });

  it('roughly preserves the hue of a colored button (L flips, H kept)', () => {
    const { html: out } = simulate(html, 'gmail-mobile', DARK);
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

  // caniemail: the Gmail apps and Yahoo do not support prefers-color-scheme.
  it('the Gmail app drops the dark block and inverts', () => {
    const { mutations, html: out } = simulate(html, 'gmail-mobile', DARK);
    const stripped = byFeature(mutations, 'css-at-media-prefers-color-scheme');
    expect(stripped).toHaveLength(1);
    expect(stripped[0].action).toBe('remove-rule');
    expect(byFeature(mutations, 'darkmode-author-override')).toHaveLength(0);
    expect(byFeature(mutations, 'darkmode-auto-invert').length).toBeGreaterThan(0);
    expect(out).not.toContain('#0b1a3a');
  });

  it('Yahoo drops the dark block and keeps the light design', () => {
    const { mutations, html: out } = simulate(html, 'yahoo', DARK);
    expect(byFeature(mutations, 'css-at-media-prefers-color-scheme')).toHaveLength(1);
    expect(out).toContain('#2563eb');
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

  it('darkens light backgrounds and lightens dark text, and leaves the rest', () => {
    const html =
      '<div style="background-color:#ffffff;color:#111111">a</div>' +
      '<div style="background-color:#111827;color:#ffffff">b</div>';
    const { html: out, mutations } = simulate(html, 'outlook-com', DARK);
    expect(out).toContain('background-color:#000000');
    expect(out).toContain(`color:${flipLightness('#111111')}`);
    expect(out).toContain('background-color:#111827;color:#ffffff');
    expect(byFeature(mutations, 'darkmode-auto-invert')).toHaveLength(2);
  });

  it('applies author dark rules on top of its own recoloring, untouched', () => {
    const html = `<style>@media (prefers-color-scheme: dark) { .c { background:#0b1a3a !important; } }</style>` +
      '<div class="c" style="background-color:#ffffff">x</div>';
    const { html: out } = simulate(html, 'outlook-com', DARK);
    expect(out).toContain('#0b1a3a');
    expect(out).toContain('background-color:#000000');
  });

  it('does not claim to honor the color-scheme meta', () => {
    const html = '<meta name="color-scheme" content="light dark"><p>x</p>';
    const { mutations } = simulate(html, 'outlook-com', DARK);
    expect(byFeature(mutations, 'darkmode-meta-only')).toHaveLength(0);
  });
});

describe('dark mode: the Gmail app ignores [data-ogsc]', () => {
  it('still inverts', () => {
    const html = `<style>[data-ogsc] .t { color:#ffffff; }</style><p class="t" style="color:#111111">x</p>`;
    const { mutations } = simulate(html, 'gmail-mobile', DARK);
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
  it('flags white button text the Gmail app turns black on a blue it barely changes', () => {
    const html = '<a style="background-color:#2563eb;color:#ffffff">Buy now</a>';
    const contrast = byFeature(simulate(html, 'gmail-mobile', DARK).mutations, 'darkmode-contrast');
    expect(contrast).toHaveLength(1);
    expect(contrast[0].severity).toBe('error');
  });

  it('treats undeclared text as following the dark scheme', () => {
    // The white card turns black and the default black text turns white.
    const html = '<div style="background-color:#ffffff">Important message</div>';
    expect(byFeature(simulate(html, 'gmail-mobile', DARK).mutations, 'darkmode-contrast')).toHaveLength(0);
  });

  it('flags dark text on an orange that Outlook.com keeps', () => {
    const html = '<td style="background-color:#f59e0b"><p style="color:#111827">Sale</p></td>';
    const html2 = `<table><tr>${html}</tr></table>`;
    expect(byFeature(simulate(html2, 'outlook-com', DARK).mutations, 'darkmode-contrast')).toHaveLength(1);
  });

  it('measures text against an ancestor background, not a default white', () => {
    // Gmail flips the card to near-black and the dark text to light: readable.
    const html =
      '<table><tr><td style="background-color:#ffffff">' +
      '<p style="color:#1c2a1f">Order confirmed</p></td></tr></table>';
    const { mutations } = simulate(html, 'gmail-mobile', DARK);
    expect(byFeature(mutations, 'darkmode-contrast')).toHaveLength(0);
  });

  it('ignores hidden text such as a preheader', () => {
    const html =
      '<div style="background-color:#ffffff">' +
      '<div style="display:none">Preheader</div><p style="color:#111111">Body</p></div>';
    const { mutations } = simulate(html, 'gmail-mobile', DARK);
    expect(byFeature(mutations, 'darkmode-contrast')).toHaveLength(0);
  });

  it('does not flag contrast for an empty (text-free) element', () => {
    const html = '<div style="background-color:#ffffff"><img src="x.png"></div>';
    const { mutations } = simulate(html, 'gmail-mobile', DARK);
    expect(byFeature(mutations, 'darkmode-contrast')).toHaveLength(0);
  });
});

describe('dark mode: image inversion warning', () => {
  it('warns once about images when inversion happens', () => {
    const html = '<div style="background-color:#ffffff"><img src="logo.png" alt="logo"></div>';
    const { mutations } = simulate(html, 'gmail-mobile', DARK);
    expect(byFeature(mutations, 'darkmode-image-inversion')).toHaveLength(1);
    expect(byFeature(mutations, 'darkmode-image-inversion')[0].severity).toBe('warning');
  });
});

describe('dark mode: light context is a no-op', () => {
  it('produces no dark-mode mutations under the default (light) context', () => {
    const html = '<div style="background-color:#ffffff;color:#111111">Hi</div>';
    const { mutations } = simulate(html, 'gmail', DEFAULT_CONTEXT);
    expect(mutations.filter((m) => m.stage === 'dark-mode')).toHaveLength(0);
  });
});

describe('dark mode: prefers-color-scheme follows the simulated scheme, not the viewer', () => {
  const html = `<style>
    @media (prefers-color-scheme: dark) { p { color:#eeeeee; } }
    @media (prefers-color-scheme: light) { p { color:#222222; } }
  </style><p>x</p>`;

  it('light render drops the dark block and applies the light one', () => {
    const { html: out, mutations } = simulate(html, 'apple-mail', DEFAULT_CONTEXT);
    expect(out).not.toContain('prefers-color-scheme');
    expect(out).not.toContain('#eeeeee');
    expect(out).toContain('#222222');
    expect(mutations.filter((m) => m.stage === 'dark-mode')).toHaveLength(0);
  });

  it('dark render drops the light block and applies the dark one', () => {
    const { html: out } = simulate(html, 'apple-mail', DARK);
    expect(out).not.toContain('prefers-color-scheme');
    expect(out).not.toContain('#222222');
    expect(out).toContain('#eeeeee');
  });

  it('a client without dark mode renders the light block', () => {
    const { html: out } = simulate(html, 'outlook-com', DEFAULT_CONTEXT);
    expect(out).toContain('#222222');
    expect(out).not.toContain('#eeeeee');
  });
});

describe('dark mode: determinism', () => {
  it('same (html, client, dark ctx) yields byte-identical output three times', () => {
    const html =
      '<div style="background-color:#ffffff"><p style="color:#333333">Body</p></div>';
    const a = simulate(html, 'gmail-mobile', DARK);
    const b = simulate(html, 'gmail-mobile', DARK);
    const c = simulate(html, 'gmail-mobile', DARK);
    expect(a.html).toBe(b.html);
    expect(b.html).toBe(c.html);
    expect(JSON.stringify(a.mutations)).toBe(JSON.stringify(c.mutations));
  });
});

describe('Outlook: percentage width, margin and padding', () => {
  it('warns on percentage width for outlook-win', () => {
    const { mutations } = simulate('<table style="width:100%"><tr><td>x</td></tr></table>', 'outlook-win');
    expect(byFeature(mutations, 'quirk-outlook-width')).toHaveLength(1);
  });

  it('drops auto margins in outlook-win, so the element is not centered', () => {
    const { mutations, html } = simulate('<div style="margin:20px auto">x</div>', 'outlook-win');
    expect(byFeature(mutations, 'css-margin')[0].action).toBe('rewrite');
    expect(html).toContain('margin:20px 0');
  });

  it('removes padding outside table cells in outlook-win', () => {
    const { html } = simulate('<a style="padding:10px">x</a><table><tr><td style="padding:10px">y</td></tr></table>', 'outlook-win');
    expect(html).toContain('<a>x</a>');
    expect(html).toContain('<td style="padding:10px">');
  });
});

import { describe, it, expect } from 'vitest';
import { simulate } from '@/src/lib/engine/engine';
import type { Mutation } from '@/src/lib/engine/types';

const byFeature = (muts: Mutation[], feature: string) =>
  muts.filter((m) => m.feature === feature);

describe('defaults: UA stylesheet injection', () => {
  it('injects the Outlook serif UA stylesheet', () => {
    const { html, mutations } = simulate('<html><body><p>Hi</p></body></html>', 'outlook-win');
    expect(html).toContain('data-ua-default');
    expect(html).toContain('Times New Roman');
    const inj = byFeature(mutations, 'default-outlook-win-ua-stylesheet');
    expect(inj).toHaveLength(1);
    expect(inj[0].action).toBe('inject-default');
    expect(inj[0].severity).toBe('info');
  });

  it('injects a sans-serif UA stylesheet for Gmail', () => {
    const { html } = simulate('<html><body><p>Hi</p></body></html>', 'gmail');
    expect(html).toContain('data-ua-default');
    expect(html).toContain('Arial');
  });
});

describe('css-filter: @media follows caniemail', () => {
  const html = `<html><head><style>
    .x { color: blue; }
    @media (max-width:600px){ .x { color: red; } }
  </style></head><body><p class="x">hi</p></body></html>`;

  it('removes @media entirely for Outlook (Windows)', () => {
    const { html: out, mutations } = simulate(html, 'outlook-win');
    expect(out).not.toContain('@media');
    const q = byFeature(mutations, 'css-at-media');
    expect(q).toHaveLength(1);
    expect(q[0].action).toBe('remove-rule');
    expect(q[0].severity).toBe('error');
  });

  it('keeps @media but warns for Yahoo (partial support)', () => {
    const { html: out, mutations } = simulate(html, 'yahoo');
    expect(out).toContain('@media');
    expect(byFeature(mutations, 'css-at-media')[0].action).toBe('warn-only');
  });

  it('keeps @media untouched for Apple Mail', () => {
    const { html: out, mutations } = simulate(html, 'apple-mail');
    expect(out).toContain('@media');
    expect(byFeature(mutations, 'css-at-media')).toHaveLength(0);
  });

  it('does not report declarations inside a removed @media block', () => {
    const { mutations } = simulate(
      '<style>@media (max-width:600px){ .x { display:flex; } }</style><p class="x">x</p>',
      'outlook-win',
    );
    expect(byFeature(mutations, 'css-display-flex')).toHaveLength(0);
  });
});

describe('css-filter: at-rules and media features', () => {
  it('removes @media (hover) for gmail, keeps it for apple-mail', () => {
    const html = '<style>@media (hover: hover){ a:hover { color:red; } }</style><a>x</a>';
    expect(byFeature(simulate(html, 'gmail').mutations, 'css-at-media-hover')[0].action).toBe('remove-rule');
    expect(simulate(html, 'apple-mail').html).toContain('@media (hover');
  });

  it('removes prefers-color-scheme blocks for gmail even in light mode', () => {
    const html = '<style>@media (prefers-color-scheme: dark){ p { color:#fff; } }</style><p>x</p>';
    const { html: out, mutations } = simulate(html, 'gmail');
    expect(byFeature(mutations, 'css-at-media-prefers-color-scheme')).toHaveLength(1);
    expect(out).not.toContain('prefers-color-scheme');
  });

  it('removes @font-face for gmail, keeps it for apple-mail', () => {
    const html = '<style>@font-face{font-family:X;src:url(x.woff2)}</style><p>x</p>';
    expect(simulate(html, 'gmail').html).not.toContain('@font-face');
    expect(simulate(html, 'apple-mail').html).toContain('@font-face');
  });

  it('removes @keyframes for outlook-com', () => {
    const html = '<style>@keyframes spin{to{transform:rotate(1turn)}}</style><p>x</p>';
    const { mutations } = simulate(html, 'outlook-com');
    expect(byFeature(mutations, 'css-at-keyframes')[0].action).toBe('remove-rule');
  });
});

describe('quirks: Outlook ignores max-width', () => {
  it('warns about max-width on a non-table element', () => {
    const html = `<div style="max-width:600px">x</div>`;
    const { mutations } = simulate(html, 'outlook-win');
    const q = byFeature(mutations, 'quirk-outlook-maxwidth');
    expect(q).toHaveLength(1);
    expect(q[0].severity).toBe('warning');
    expect(q[0].target.property).toBe('max-width');
  });

  it('does not warn for Gmail', () => {
    const { mutations } = simulate(`<div style="max-width:600px">x</div>`, 'gmail');
    expect(byFeature(mutations, 'quirk-outlook-maxwidth')).toHaveLength(0);
  });
});

describe('quirks: Gmail 102KB clipping', () => {
  const big =
    '<html><body>' +
    '<p style="color:#111111">Filler content for the clipping test.</p>'.repeat(3000) +
    '</body></html>';

  it('clips oversized messages and appends the notice', () => {
    const { html, mutations } = simulate(big, 'gmail');
    expect(html).toContain('[Message clipped]');
    const clip = byFeature(mutations, 'quirk-gmail-clipping');
    expect(clip).toHaveLength(1);
    // Body was cut down to ~102KB + the small banner.
    expect(new TextEncoder().encode(html).length).toBeLessThan(102 * 1024 + 500);
  });

  it('does not clip for Apple Mail', () => {
    const { html, mutations } = simulate(big, 'apple-mail');
    expect(html).not.toContain('[Message clipped]');
    expect(byFeature(mutations, 'quirk-gmail-clipping')).toHaveLength(0);
  });

  it('does not clip a small message for Gmail', () => {
    const { html } = simulate('<html><body><p>tiny</p></body></html>', 'gmail');
    expect(html).not.toContain('[Message clipped]');
  });
});

describe('quirks: fixed widths wider than a phone', () => {
  const PHONE = { colorScheme: 'light' as const, viewportWidth: 375 };
  const fit = (html: string, client: Parameters<typeof simulate>[1] = 'gmail-mobile') =>
    byFeature(simulate(html, client, PHONE).mutations, 'quirk-mobile-fixed-width');

  it('flags a 600px table with no mobile rule', () => {
    const m = fit('<table width="600"><tr><td>x</td></tr></table>');
    expect(m).toHaveLength(1);
    expect(m[0].severity).toBe('warning');
  });

  it('accepts a mobile rule that resizes it', () => {
    const html = `<style>@media (max-width:600px){ .c { width:100% !important; } }</style>
      <table class="c" width="600"><tr><td>x</td></tr></table>`;
    expect(fit(html)).toHaveLength(0);
  });

  it('ignores a rule that does not apply at phone width', () => {
    const html = `<style>@media (min-width:601px){ .c { width:100% !important; } }</style>
      <table class="c" width="600"><tr><td>x</td></tr></table>`;
    expect(fit(html)).toHaveLength(1);
  });

  it('needs !important to override an inline width', () => {
    const rule = (imp: string) => `<style>@media (max-width:600px){ .c { width:100%${imp}; } }</style>
      <div class="c" style="width:600px">x</div>`;
    expect(fit(rule(''))).toHaveLength(1);
    expect(fit(rule(' !important'))).toHaveLength(0);
  });

  it('accepts fluid widths and inline max-width', () => {
    expect(fit('<table width="100%"><tr><td>x</td></tr></table>')).toHaveLength(0);
    expect(fit('<img src="a.png" width="600" style="max-width:100%">')).toHaveLength(0);
  });

  it('reports only the outermost overflowing element', () => {
    expect(fit('<table width="600"><tr><td width="560">x</td></tr></table>')).toHaveLength(1);
  });

  it('does not run for desktop clients', () => {
    expect(fit('<table width="600"><tr><td>x</td></tr></table>', 'gmail')).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { simulate } from '@/src/lib/engine/engine';
import type { Mutation } from '@/src/lib/engine/types';

const fixturesDir = join(dirname(fileURLToPath(import.meta.url)), '../fixtures');
const fixture = (name: string) => readFileSync(join(fixturesDir, name), 'utf8');

const byFeature = (muts: Mutation[], feature: string) =>
  muts.filter((m) => m.feature === feature);

describe('css-filter: value-level (display:flex)', () => {
  const html = `<div style="display:flex; color:red;">x</div>`;

  it('removes display:flex for outlook-win with a correct location', () => {
    const { mutations, html: out } = simulate(html, 'outlook-win');
    const flex = byFeature(mutations, 'css-display-flex');
    expect(flex).toHaveLength(1);
    expect(flex[0].action).toBe('remove-value');
    expect(flex[0].severity).toBe('error');
    // `<div style="` is 12 chars, so `display` begins at column 13 on line 1.
    expect(flex[0].target.loc).toMatchObject({ startLine: 1, startCol: 13 });
    // The declaration is actually gone from the output; color:red survives.
    expect(out).not.toContain('display:flex');
    expect(out).toContain('color:red');
  });

  it('leaves display:flex untouched for apple-mail', () => {
    const { mutations, html: out } = simulate(html, 'apple-mail');
    expect(byFeature(mutations, 'css-display-flex')).toHaveLength(0);
    expect(out).toContain('display:flex');
  });

  it('does not touch display:block for outlook-win', () => {
    const { mutations, html: out } = simulate(
      `<div style="display:block;">x</div>`,
      'outlook-win',
    );
    expect(byFeature(mutations, 'css-display-flex')).toHaveLength(0);
    expect(out).toContain('display:block');
  });
});

describe('css-filter: property-level (border-radius)', () => {
  const html = `<div style="border-radius:8px;">x</div>`;

  it('removes border-radius for outlook-win', () => {
    const { mutations, html: out } = simulate(html, 'outlook-win');
    const br = byFeature(mutations, 'css-border-radius');
    expect(br).toHaveLength(1);
    expect(br[0].action).toBe('remove-property');
    expect(out).not.toContain('border-radius');
  });

  it('does nothing for gmail', () => {
    const { mutations, html: out } = simulate(html, 'gmail');
    expect(byFeature(mutations, 'css-border-radius')).toHaveLength(0);
    expect(out).toContain('border-radius');
  });
});

describe('css-filter: shorthand expansion (background-image)', () => {
  const html = `<div style="background: #fff url(a.png) no-repeat;">x</div>`;

  it('catches the background-image part of a shorthand for outlook-win', () => {
    const { mutations, html: out } = simulate(html, 'outlook-win');
    const img = byFeature(mutations, 'css-background-image');
    expect(img).toHaveLength(1);
    expect(img[0].action).toBe('remove-value');
    expect(img[0].reason).toContain('shorthand');
    // Only the url() token is removed; the rest of the shorthand remains.
    expect(out).not.toContain('url(a.png)');
    expect(out).toContain('#fff');
  });

  it('leaves the whole background shorthand for gmail', () => {
    const { mutations, html: out } = simulate(html, 'gmail');
    expect(byFeature(mutations, 'css-background-image')).toHaveLength(0);
    expect(out).toContain('url(a.png)');
  });
});

describe('sanitize: unwrap preserves content', () => {
  it('unwraps an unsupported inline element but keeps its text', () => {
    const html = `<p>Read <abbr title="fyi">FYI</abbr> now</p>`;
    const { mutations, html: out } = simulate(html, 'outlook-win');
    const abbr = byFeature(mutations, 'html-abbr');
    expect(abbr).toHaveLength(1);
    expect(abbr[0].action).toBe('unwrap-element');
    expect(out).not.toContain('<abbr');
    expect(out).toContain('FYI'); // content preserved
  });

  it('removes script entirely for every client', () => {
    const html = `<div><script>evil()</script>ok</div>`;
    const { html: out, mutations } = simulate(html, 'gmail');
    expect(out).not.toContain('script');
    expect(out).toContain('ok');
    expect(mutations.some((m) => m.target.element === 'script')).toBe(true);
  });
});

describe('sanitize: <link> and <base> follow caniemail', () => {
  const link = '<link rel="stylesheet" href="a.css"><p>x</p>';

  it.each(['apple-mail', 'outlook-win'] as const)('keeps <link> in %s', (client) => {
    const { html: out, mutations } = simulate(link, client);
    expect(out).toContain('<link');
    expect(mutations.filter((m) => m.target.element === 'link')).toHaveLength(0);
  });

  it('removes <link> in gmail with the html-link evidence', () => {
    const { html: out, mutations } = simulate(link, 'gmail');
    expect(out).not.toContain('<link');
    const m = byFeature(mutations, 'html-link');
    expect(m).toHaveLength(1);
    expect(m[0].action).toBe('remove-element');
  });

  it('warns on <base> in gmail (partial) and keeps it', () => {
    const { html: out, mutations } = simulate('<base href="https://example.com/"><p>x</p>', 'gmail');
    expect(out).toContain('<base');
    expect(byFeature(mutations, 'html-base')[0].action).toBe('warn-only');
  });
});

describe('determinism', () => {
  it('produces byte-identical output across repeated runs', () => {
    const html = fixture('newsletter.html');
    const runs = [0, 1, 2].map(() => simulate(html, 'outlook-win'));
    const [a, b, c] = runs;
    expect(a.html).toBe(b.html);
    expect(b.html).toBe(c.html);
    expect(JSON.stringify(a.mutations)).toBe(JSON.stringify(b.mutations));
    expect(JSON.stringify(b.mutations)).toBe(JSON.stringify(c.mutations));
  });

  it('every mutation carries an evidence link', () => {
    for (const name of ['newsletter.html', 'promo.html', 'unsupported-elements.html']) {
      const { mutations } = simulate(fixture(name), 'outlook-win');
      for (const m of mutations) {
        expect(m.evidence).toBeTruthy();
        expect(m.evidence).toMatch(/^https?:\/\//);
      }
    }
  });
});

describe('sanitize: <input> and <button> types', () => {
  it('checks <input type="submit"> against its own entry (outlook-com: n)', () => {
    const { html: out, mutations } = simulate('<input type="submit" value="Go">', 'outlook-com');
    expect(byFeature(mutations, 'html-input-submit')[0].action).toBe('remove-element');
    expect(out).not.toContain('<input');
  });

  it('keeps <input type="text"> in outlook-com', () => {
    const { html: out } = simulate('<input type="text">', 'outlook-com');
    expect(out).toContain('<input');
  });

  it('checks <button type="reset"> against html-button-reset (yahoo: n)', () => {
    const { mutations } = simulate('<button type="reset">Clear</button>', 'yahoo');
    expect(byFeature(mutations, 'html-button-reset')).toHaveLength(1);
    expect(byFeature(mutations, 'html-button-submit')).toHaveLength(0);
  });
});

describe('css-filter: longhands, logical properties and keywords', () => {
  it('removes a border-radius longhand for outlook-win', () => {
    const { html: out, mutations } = simulate('<div style="border-top-left-radius:8px">x</div>', 'outlook-win');
    expect(byFeature(mutations, 'css-border-radius')[0].action).toBe('remove-property');
    expect(out).not.toContain('radius');
  });

  it('removes margin-inline and left for gmail', () => {
    const { mutations } = simulate('<div style="margin-inline:auto;left:10px">x</div>', 'gmail');
    expect(byFeature(mutations, 'css-margin-inline-block')).toHaveLength(1);
    expect(byFeature(mutations, 'css-left-right-top-bottom')).toHaveLength(1);
  });

  it('warns on margin-top (partial in gmail)', () => {
    const { mutations } = simulate('<div style="margin-top:10px">x</div>', 'gmail');
    expect(byFeature(mutations, 'css-margin')[0].action).toBe('warn-only');
  });

  it('does not count a shorthand twice through its expanded longhands', () => {
    const { mutations } = simulate('<div style="margin:10px 20px">x</div>', 'gmail');
    expect(byFeature(mutations, 'css-margin')).toHaveLength(1);
  });

  it('removes fit-content for outlook-win', () => {
    const { mutations } = simulate('<div style="width:fit-content">x</div>', 'outlook-win');
    expect(byFeature(mutations, 'css-intrinsic-size')[0].action).toBe('remove-value');
  });
});

describe('css-filter: variables, !important and keywords', () => {
  const vars = '<style>:root{--brand:#ff0000}.a{color:var(--brand)}</style><p class="a">x</p>';

  it('removes custom properties and var() for gmail', () => {
    const { html: out, mutations } = simulate(vars, 'gmail');
    expect(byFeature(mutations, 'css-variables')).toHaveLength(2);
    expect(out).not.toContain('--brand');
  });

  it('keeps them for apple-mail', () => {
    const { html: out } = simulate(vars, 'apple-mail');
    expect(out).toContain('var(--brand)');
  });

  it('warns once on !important (partial in gmail), even on a shorthand', () => {
    const { mutations } = simulate('<p style="margin:0 !important">x</p>', 'gmail');
    const m = byFeature(mutations, 'css-important');
    expect(m).toHaveLength(1);
    expect(m[0].action).toBe('warn-only');
  });

  it('drops only system-ui from a font stack in outlook-win', () => {
    const { html: out, mutations } = simulate(
      '<p style="font-family:system-ui, Arial, sans-serif">x</p>',
      'outlook-win',
    );
    expect(byFeature(mutations, 'css-sytem-ui')[0].action).toBe('remove-value');
    expect(out).toContain('font-family:Arial, sans-serif');
  });

  it('removes the initial keyword for yahoo', () => {
    const { html: out } = simulate('<p style="color:initial">x</p>', 'yahoo');
    expect(out).not.toContain('initial');
  });
});

describe('css-filter: selectors and nesting', () => {
  it('removes a rule whose only selector uses :nth-child in gmail', () => {
    const { html: out, mutations } = simulate(
      '<style>tr:nth-child(2n){color:red}</style><p>x</p>',
      'gmail',
    );
    expect(byFeature(mutations, 'css-pseudo-class-nth-child')[0].action).toBe('remove-rule');
    expect(out).not.toContain('nth-child');
  });

  it('drops only the unsupported selector from a list', () => {
    const { html: out } = simulate('<style>p, li:first-child{color:red}</style><p>x</p>', 'gmail');
    expect(out).toContain('p{color:red}');
    expect(out).not.toContain('first-child');
  });

  it('keeps :hover for gmail and removes it for outlook-win', () => {
    const html = '<style>a:hover{color:red}</style><a>x</a>';
    expect(simulate(html, 'gmail').html).toContain('a:hover');
    expect(simulate(html, 'outlook-win').html).not.toContain('a:hover');
  });

  it('treats single-colon :before as the ::before pseudo-element', () => {
    const { mutations } = simulate('<style>p:before{content:"x"}</style><p>x</p>', 'gmail');
    expect(byFeature(mutations, 'css-pseudo-element-before')).toHaveLength(1);
  });

  it('flags chained classes (.a.b) in outlook-com but not td.a', () => {
    const chained = simulate('<style>.a.b{color:red}</style><p>x</p>', 'outlook-com');
    expect(byFeature(chained.mutations, 'css-selector-chaining')).toHaveLength(1);
    const typed = simulate('<style>td.a{color:red}</style><p>x</p>', 'outlook-com');
    expect(byFeature(typed.mutations, 'css-selector-chaining')).toHaveLength(0);
  });

  it('removes the child combinator in outlook-win, not the descendant one', () => {
    const { html: out } = simulate('<style>div > p{color:red} div p{color:blue}</style><p>x</p>', 'outlook-win');
    expect(out).not.toContain('div > p');
    expect(out).toContain('div p{color:blue}');
  });

  it('removes nested rules in gmail', () => {
    const { mutations, html: out } = simulate('<style>.a{color:red; .b{color:blue}}</style><p>x</p>', 'gmail');
    expect(byFeature(mutations, 'css-nesting')[0].action).toBe('remove-rule');
    expect(out).not.toContain('.b');
  });

  it('leaves @keyframes selectors alone', () => {
    const { mutations } = simulate('<style>@keyframes s{from{opacity:0}to{opacity:1}}</style><p>x</p>', 'apple-mail');
    expect(mutations.filter((m) => m.feature.startsWith('css-selector'))).toHaveLength(0);
  });
});

describe('sanitize: attributes', () => {
  it('removes hidden in gmail, so the content shows', () => {
    const { html: out, mutations } = simulate('<div hidden>secret</div>', 'gmail');
    const m = byFeature(mutations, 'html-hidden');
    expect(m[0].action).toBe('remove-attribute');
    expect(out).not.toContain('hidden');
    expect(out).toContain('secret');
  });

  it('removes srcset and sizes in gmail but keeps src', () => {
    const { html: out } = simulate('<img src="a.png" srcset="a@2x.png 2x" sizes="100vw">', 'gmail');
    expect(out).not.toContain('srcset');
    expect(out).not.toContain('sizes');
    expect(out).toContain('src="a.png"');
  });

  it('keeps hidden for apple-mail', () => {
    expect(simulate('<div hidden>x</div>', 'apple-mail').html).toContain('hidden');
  });

  it('warns on width attributes in outlook-win (partial) and keeps them', () => {
    const { html: out, mutations } = simulate('<table width="600"><tr><td>x</td></tr></table>', 'outlook-win');
    expect(byFeature(mutations, 'html-width')[0].action).toBe('warn-only');
    expect(out).toContain('width="600"');
  });

  it('warns on same-document anchor links in yahoo only', () => {
    expect(byFeature(simulate('<a href="#top">x</a>', 'yahoo').mutations, 'html-anchor-links')).toHaveLength(1);
    expect(byFeature(simulate('<a href="https://example.com/">x</a>', 'yahoo').mutations, 'html-anchor-links')).toHaveLength(0);
  });
});

describe('sanitize: semantics, lists, style, doctype', () => {
  it('unwraps <section> in outlook-win and keeps its content', () => {
    const { html: out, mutations } = simulate('<section><p>x</p></section>', 'outlook-win');
    expect(byFeature(mutations, 'html-semantics')[0].action).toBe('unwrap-element');
    expect(out).not.toContain('<section');
    expect(out).toContain('<p>x</p>');
  });

  it('warns on <section> in gmail (partial)', () => {
    expect(byFeature(simulate('<section>x</section>', 'gmail').mutations, 'html-semantics')[0].action)
      .toBe('warn-only');
  });

  it('warns on lists where support is partial', () => {
    expect(byFeature(simulate('<ul><li>x</li></ul>', 'gmail').mutations, 'html-lists')).toHaveLength(1);
    expect(byFeature(simulate('<ul><li>x</li></ul>', 'apple-mail').mutations, 'html-lists')).toHaveLength(0);
  });

  it('warns on <style> in gmail and keeps it', () => {
    const { html: out, mutations } = simulate('<style>p{color:red}</style><p>x</p>', 'gmail');
    expect(byFeature(mutations, 'html-style')[0].action).toBe('warn-only');
    expect(out).toContain('p{color:red}');
  });

  it('reports the HTML5 doctype in outlook-win without removing it', () => {
    const { html: out, mutations } = simulate('<!DOCTYPE html><p>x</p>', 'outlook-win');
    expect(byFeature(mutations, 'html-doctype')[0].action).toBe('warn-only');
    expect(out).toMatch(/^<!DOCTYPE html>/);
  });
});

describe('sanitize: image formats', () => {
  it('drops a base64 image src in gmail', () => {
    const { html: out, mutations } = simulate('<img src="data:image/png;base64,AAAA" alt="logo">', 'gmail');
    const m = byFeature(mutations, 'image-base64');
    expect(m[0].action).toBe('remove-attribute');
    expect(m[0].reason).toContain('does not display');
    expect(out).not.toContain('data:image');
    expect(out).toContain('alt="logo"');
  });

  it('drops a WebP src in outlook-win, even with a query string', () => {
    const { mutations } = simulate('<img src="https://cdn.example.com/a.webp?v=2">', 'outlook-win');
    expect(byFeature(mutations, 'image-webp')[0].action).toBe('remove-attribute');
  });

  it('warns on SVG images in gmail (partial) and keeps them', () => {
    const { html: out, mutations } = simulate('<img src="logo.svg">', 'gmail');
    expect(byFeature(mutations, 'image-svg')[0].action).toBe('warn-only');
    expect(out).toContain('logo.svg');
  });

  it('leaves PNG and JPEG alone everywhere', () => {
    for (const client of ['gmail', 'outlook-win', 'outlook-com', 'apple-mail', 'yahoo'] as const) {
      const { mutations } = simulate('<img src="a.png"><img src="b.JPG">', client);
      expect(mutations.filter((m) => m.feature.startsWith('image-'))).toHaveLength(0);
    }
  });
});

describe('sanitize: implied elements', () => {
  it('does not report a <body> the parser added', () => {
    expect(byFeature(simulate('<p>x</p>', 'gmail').mutations, 'html-body')).toHaveLength(0);
    expect(byFeature(simulate('<body><p>x</p></body>', 'gmail').mutations, 'html-body')).toHaveLength(1);
  });
});

describe('phone clients', () => {
  it('Outlook app keeps flex and border-radius that Outlook on Windows drops', () => {
    const html = '<div style="display:flex;border-radius:8px">x</div>';
    expect(byFeature(simulate(html, 'outlook-win').mutations, 'css-display-flex')).toHaveLength(1);
    const { html: out, mutations } = simulate(html, 'outlook-mobile');
    expect(byFeature(mutations, 'css-display-flex')).toHaveLength(0);
    expect(out).toContain('border-radius:8px');
  });

  it('Outlook app applies prefers-color-scheme in dark mode', () => {
    const html = '<style>@media (prefers-color-scheme: dark){ p { color:#eeeeee; } }</style><p>x</p>';
    const { html: out } = simulate(html, 'outlook-mobile', { colorScheme: 'dark', viewportWidth: 375 });
    expect(out).toContain('#eeeeee');
  });

  it('every phone client has a profile on the mobile device', async () => {
    const { PROFILES, CLIENTS_BY_DEVICE, clientOn } = await import('@/src/lib/engine/profiles');
    for (const id of CLIENTS_BY_DEVICE.mobile) expect(PROFILES[id].device).toBe('mobile');
    expect(clientOn('mobile', 'outlook-com')).toBe('outlook-mobile');
    expect(clientOn('desktop', 'outlook-mobile')).toBe('outlook-win');
    expect(clientOn('desktop', 'gmail')).toBe('gmail');
  });
});

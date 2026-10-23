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

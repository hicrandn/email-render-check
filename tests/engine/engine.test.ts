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

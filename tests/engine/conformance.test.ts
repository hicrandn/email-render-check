// Conformance: for every client, desktop and phone, the engine's decision on
// each Can I Email entry matches the snapshot.
//
//   n -> reported as an error, and the thing is gone from the output
//   a -> reported as a warning (unless an unsupported entry already removed it)
//   y / u -> not reported
//
// Each case lists every entry its HTML relies on, since the engine reports
// only the first unsupported one. A coverage test at the end makes sure every
// snapshot entry is exercised here or listed, with a reason, as not modelled.
import { describe, it, expect } from 'vitest';
import { simulate } from '@/src/lib/engine/engine';
import { featureBySlug, snapshot } from '@/src/lib/engine/data/snapshot';
import { CUSTOM_PROPERTY_SLUG, IMPORTANT_SLUG, SLUG_MAP } from '@/src/lib/engine/data/slug-map';
import {
  ATTRIBUTE_SLUG,
  ELEMENT_SLUG,
  IMAGE_EXTENSION_SLUG,
  IMAGE_MIME_SLUG,
  INPUT_TYPE_SLUG,
} from '@/src/lib/engine/stages/sanitize';
import { AT_RULE_SLUG } from '@/src/lib/engine/stages/css-rules';
import { PROFILES } from '@/src/lib/engine/profiles';
import { CLIENT_IDS, type ClientId, type Mutation } from '@/src/lib/engine/types';

interface Case {
  name: string;
  html: string;
  /** Every caniemail entry the HTML relies on. */
  slugs: string[];
  /** Present in the output while kept; must be gone when an entry is unsupported. */
  marker?: RegExp;
}

const exercised = new Set<string>();
function add(cases: Case[], c: Case): void {
  c.slugs.forEach((s) => exercised.add(s));
  cases.push(c);
}

// --- CSS declarations -------------------------------------------------------

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const declCase = (name: string, decl: string, slugs: string[]): Case => ({
  name,
  html: `<div style="${decl}">x</div>`,
  slugs,
  marker: new RegExp(escape(decl)),
});

const cssCases: Case[] = [];
for (const [prop, mappings] of SLUG_MAP.byProperty) {
  // `inherit` matches no value, function, unit or keyword entry.
  add(cssCases, declCase(`property ${prop}`, `${prop}: inherit`, mappings.map((m) => m.slug)));
}
for (const m of SLUG_MAP.valueMappings) {
  const props = (SLUG_MAP.byProperty.get(m.property) ?? []).map((p) => p.slug);
  add(cssCases, declCase(`value ${m.property}: ${m.values[0]}`, `${m.property}: ${m.values[0]}`, [m.slug, ...props]));
}
// zz-test is not a property, so only the entry under test can match.
for (const m of SLUG_MAP.functionMappings) {
  add(cssCases, declCase(`function ${m.functions[0]}()`, `zz-test: ${m.functions[0]}(1)`, [m.slug]));
}
for (const m of SLUG_MAP.unitMappings) {
  add(cssCases, declCase(`unit ${m.units[0]}`, `zz-test: 1${m.units[0]}`, [m.slug]));
}
for (const m of SLUG_MAP.keywordMappings) {
  add(cssCases, declCase(`keyword ${m.keywords[0]}`, `zz-test: ${m.keywords[0]}`, [m.slug]));
}
add(cssCases, declCase('!important', 'zz-test: 1 !important', [IMPORTANT_SLUG]));
add(cssCases, declCase('custom property', '--zz-test: 1', [CUSTOM_PROPERTY_SLUG]));

// --- at-rules, selectors, nesting -------------------------------------------

const ruleCases: Case[] = [];
const AT_RULE_CSS: Record<string, string> = {
  media: '@media screen { p { color: red } }',
  'font-face': '@font-face { font-family: zz }',
  import: '@import url(zz.css);',
  keyframes: '@keyframes zz { from { opacity: 0 } }',
  '-webkit-keyframes': '@-webkit-keyframes zz { from { opacity: 0 } }',
  supports: '@supports (display: grid) { p { color: red } }',
};
for (const [name, slug] of Object.entries(AT_RULE_SLUG)) {
  const css = AT_RULE_CSS[name];
  add(ruleCases, {
    name: `@${name}`,
    html: `<style>${css}</style><p>x</p>`,
    slugs: [slug, ...(css.includes('{ p {') ? ['css-selector-type'] : [])],
    marker: new RegExp(`@${escape(name)}`),
  });
}
const MEDIA_FEATURES: [string, string][] = [
  ['(prefers-color-scheme: light)', 'css-at-media-prefers-color-scheme'],
  ['(prefers-reduced-motion: reduce)', 'css-at-media-prefers-reduced-motion'],
  ['(hover: hover)', 'css-at-media-hover'],
  ['(any-hover: hover)', 'css-at-media-hover'],
  ['(orientation: portrait)', 'css-at-media-orientation'],
  ['(-webkit-min-device-pixel-ratio: 2)', 'css-at-media-device-pixel-ratio'],
];
for (const [query, slug] of MEDIA_FEATURES) {
  add(ruleCases, {
    name: `@media ${query}`,
    html: `<style>@media ${query} { .zz { color: red } }</style><p class="zz">x</p>`,
    slugs: [slug, 'css-at-media', 'css-selector-class'],
    // The light-scheme block is applied (hoisted) when supported, so only
    // its contents are a reliable marker.
    marker: /\.zz/,
  });
}

const PSEUDO_ARGS: Record<string, string> = {
  'nth-child': '(2)',
  'nth-last-child': '(2)',
  'nth-of-type': '(2)',
  'nth-last-of-type': '(2)',
  not: '(.zz)',
  has: '(.zz)',
  lang: '(en)',
};
const SELECTORS: [string, string[]][] = [
  ['div > p', ['css-selector-child', 'css-selector-type']],
  ['div + p', ['css-selector-adjacent-sibling', 'css-selector-type']],
  ['div ~ p', ['css-selector-general-sibling', 'css-selector-type']],
  ['div p', ['css-selector-descendant', 'css-selector-type']],
  ['*', ['css-selector-universal']],
  ['[title]', ['css-selector-attribute']],
  ['.zz', ['css-selector-class']],
  ['#zz', ['css-selector-id']],
  ['p', ['css-selector-type']],
  ['.zz.yy', ['css-selector-chaining', 'css-selector-class']],
];
for (const f of snapshot.features) {
  const pc = /^css-pseudo-class-(.+)$/.exec(f.slug);
  const pe = /^css-pseudo-element-(.+)$/.exec(f.slug);
  if (pc) {
    const args = PSEUDO_ARGS[pc[1]] ?? '';
    SELECTORS.push([`p:${pc[1]}${args}`, [f.slug, 'css-selector-type', ...(args.includes('.zz') ? ['css-selector-class'] : [])]]);
  }
  if (pe) SELECTORS.push([`p::${pe[1]}`, [f.slug, 'css-selector-type']]);
}
for (const [selector, slugs] of SELECTORS) {
  add(ruleCases, {
    name: `selector ${selector}`,
    html: `<style>${selector} { color: red }</style><div><p class="zz yy" id="zz" title="t">x</p></div>`,
    slugs,
    marker: new RegExp(`${escape(selector)}\\s*\\{`),
  });
}
add(ruleCases, {
  name: 'comment',
  html: '<style>/* zz */ p { color: red }</style><p>x</p>',
  slugs: ['css-comments', 'css-selector-type'],
  marker: /\/\* zz/,
});
add(ruleCases, {
  name: 'nesting',
  html: '<style>.zz { color: red; .yy { color: blue } }</style><p class="zz">x</p>',
  slugs: ['css-nesting', 'css-selector-class'],
  marker: /\.yy/,
});

// --- HTML elements, attributes, images ---------------------------------------

const VOID = new Set(['img', 'hr', 'wbr', 'base', 'link', 'area', 'input']);
const elementHtml = (tag: string) =>
  tag === 'body' ? '<body><p>x</p></body>' :
  tag === 'style' ? '<style>p { color: red }</style><p>x</p>' :
  VOID.has(tag) ? `<${tag}>` : `<${tag}>x</${tag}>`;

const htmlCases: Case[] = [];
for (const [tag, slug] of Object.entries(ELEMENT_SLUG)) {
  add(htmlCases, { name: `<${tag}>`, html: elementHtml(tag), slugs: [slug], marker: new RegExp(`<${tag}[\\s>]`) });
}
for (const [type, slug] of Object.entries({ ...INPUT_TYPE_SLUG, text: 'html-input-text' })) {
  add(htmlCases, { name: `<input type=${type}>`, html: `<input type="${type}">`, slugs: [slug], marker: /<input/ });
}
for (const [type, slug] of [['submit', 'html-button-submit'], ['reset', 'html-button-reset']]) {
  add(htmlCases, { name: `<button type=${type}>`, html: `<button type="${type}">x</button>`, slugs: [slug], marker: /<button/ });
}
for (const [attr, slug] of Object.entries(ATTRIBUTE_SLUG)) {
  add(htmlCases, { name: `[${attr}]`, html: `<div ${attr}="1">x</div>`, slugs: [slug], marker: new RegExp(`\\s${attr}=`) });
}
add(htmlCases, { name: 'anchor link', html: '<a href="#zz">x</a>', slugs: ['html-anchor-links'], marker: /href="#zz"/ });
add(htmlCases, { name: 'mailto link', html: '<a href="mailto:a@example.com">x</a>', slugs: ['html-mailto-links'], marker: /mailto:/ });
for (const [ext, slug] of Object.entries(IMAGE_EXTENSION_SLUG)) {
  add(htmlCases, { name: `.${ext} image`, html: `<img src="zz.${ext}">`, slugs: [slug], marker: new RegExp(`zz\\.${ext}`) });
}
for (const [mime, slug] of Object.entries(IMAGE_MIME_SLUG)) {
  add(htmlCases, {
    name: `${mime} data URI`,
    html: `<img src="data:${mime};base64,AAAA">`,
    slugs: ['image-base64', slug],
    marker: /src="data:/,
  });
}

// --- the check ---------------------------------------------------------------

function violations(client: ClientId, cases: Case[]): string[] {
  const out: string[] = [];
  const viewportWidth = PROFILES[client].device === 'mobile' ? 393 : 600;
  for (const c of cases) {
    const { html, mutations } = simulate(c.html, client, { colorScheme: 'light', viewportWidth });
    const reported = (slug: string, pred: (m: Mutation) => boolean) =>
      mutations.some((m) => m.feature === slug && pred(m));
    const statuses = c.slugs.map((s) => featureBySlug.get(s)!.support[client].status);
    const unsupported = c.slugs.filter((_, i) => statuses[i] === 'n');

    if (unsupported.length > 0) {
      if (!unsupported.some((s) => reported(s, (m) => m.severity === 'error'))) {
        out.push(`${c.name}: ${unsupported.join(', ')} is unsupported but not reported as an error`);
      }
      if (c.marker && c.marker.test(html)) out.push(`${c.name}: unsupported but still in the output`);
    }
    c.slugs.forEach((slug, i) => {
      const st = statuses[i];
      if (st === 'a' && unsupported.length === 0 && !reported(slug, (m) => m.action === 'warn-only')) {
        out.push(`${c.name}: ${slug} is partial but not reported as a warning`);
      }
      if ((st === 'y' || st === 'u') && reported(slug, () => true)) {
        out.push(`${c.name}: ${slug} is supported but reported`);
      }
    });
    if (unsupported.length === 0 && c.marker && !c.marker.test(html)) {
      out.push(`${c.name}: supported but missing from the output`);
    }
  }
  return out;
}

describe.each(CLIENT_IDS)('conformance: %s follows Can I Email', (client) => {
  it('CSS declarations', () => expect(violations(client, cssCases)).toEqual([]));
  it('at-rules, selectors and nesting', () => expect(violations(client, ruleCases)).toEqual([]));
  it('HTML elements, attributes and images', () => expect(violations(client, htmlCases)).toEqual([]));
});

// Entries the checks above don't exercise, and why.
const NOT_MODELLED: Record<string, string> = {
  amp: 'AMP is a separate MIME part, not HTML the engine sees',
  bimi: 'a DNS/sender-authentication feature',
  'html-comments': 'comments are left as they are',
  'html-doctype': 'reported as a warning only, never removed (engine.test.ts)',
  'html-meta-color-scheme': 'used by the dark-mode stage (dark-mode.test.ts)',
  'css-at-media-prefers-color-scheme': 'resolved by the dark-mode stage (dark-mode.test.ts)',
  'css-selector-grouping': 'every client supports it; a selector list is checked per selector',
};

describe('conformance coverage', () => {
  it('exercises every snapshot entry, or says why not', () => {
    exercised.add('css-at-media-prefers-color-scheme');
    const missing = snapshot.features
      .map((f) => f.slug)
      .filter((s) => !exercised.has(s) && !(s in NOT_MODELLED));
    expect(missing).toEqual([]);
  });
});

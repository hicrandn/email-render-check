// Part of the quirks stage, for phone clients: flags fixed widths wider than
// the screen that no mobile rule resizes, i.e. emails that scroll sideways
// (or get scaled down as a whole) on a phone.
//
// Runs after the CSS filter, so only @media rules the client kept count. A
// width attribute is overridden by any CSS width; an inline style width only
// by an !important one. Selector matching is approximate: a responsive rule
// counts when the last compound of its selector (tag, classes, id) fits the
// element; combinators and pseudo-classes are not checked.
import valueParser from 'postcss-value-parser';
import selectorParser from 'postcss-selector-parser';
import type { AtRule, Declaration } from 'postcss';
import type { SourceLocation } from '../types';
import { attrLoc, elementLoc, getAttr, walkElements, type Element, type Node } from '../parse/html';
import type { StageContext } from './context';

const FIT_DOC = 'https://www.caniemail.com/features/css-at-media/';
const SIZED_TAGS = new Set(['table', 'td', 'th', 'img', 'div']);
const WIDTH_PROPS = new Set(['width', 'max-width']);

/** px for `600`, `600px` or `37.5em`; null for %, auto and anything else. */
function toPx(value: string): number | null {
  const dim = valueParser.unit(value.trim());
  if (!dim) return null;
  const n = Number(dim.number);
  if (Number.isNaN(n)) return null;
  const unit = dim.unit.toLowerCase();
  if (unit === '' || unit === 'px') return n;
  if (unit === 'em' || unit === 'rem') return n * 16;
  return null;
}

/** Whether a media query list applies at this viewport width. */
function mediaApplies(params: string, viewport: number): boolean {
  const queries: valueParser.Node[][] = [[]];
  for (const node of valueParser(params).nodes) {
    if (node.type === 'div' && node.value === ',') queries.push([]);
    else queries[queries.length - 1].push(node);
  }
  return queries.some((query) => {
    let applies = true;
    for (const node of query) {
      if (node.type === 'word' && node.value.toLowerCase() === 'print') applies = false;
      if (node.type !== 'function' || node.value !== '') continue;
      const words = node.nodes.filter((n) => n.type === 'word').map((n) => n.value.toLowerCase());
      const [feature, value] = words;
      const px = value ? toPx(value) : null;
      if (px === null) continue;
      if (/^max-(device-)?width$/.test(feature) && viewport > px) applies = false;
      if (/^min-(device-)?width$/.test(feature) && viewport < px) applies = false;
    }
    return applies;
  });
}

/** A declaration that makes an element fit the screen. */
function fits(decl: Declaration, viewport: number): boolean {
  if (!WIDTH_PROPS.has(decl.prop.toLowerCase())) return false;
  const value = decl.value.trim().toLowerCase();
  if (value === 'auto' || value.endsWith('%')) return true;
  const px = toPx(value);
  return px !== null && px <= viewport;
}

interface ResponsiveRule {
  /** Subject compounds: each a list of required tag/class/id tokens. */
  subjects: { tag?: string; classes: string[]; id?: string }[];
  important: boolean;
}

function responsiveRules(ctx: StageContext, viewport: number): ResponsiveRule[] {
  const rules: ResponsiveRule[] = [];
  for (const sheet of ctx.sheets) {
    if (sheet.source.kind !== 'block') continue;
    sheet.root.walkAtRules('media', (at: AtRule) => {
      if (!mediaApplies(at.params, viewport)) return;
      at.walkRules((rule) => {
        const decls = (rule.nodes ?? []).filter(
          (n): n is Declaration => n.type === 'decl' && fits(n, viewport),
        );
        if (decls.length === 0) return;
        let parsed: selectorParser.Root;
        try {
          parsed = selectorParser().astSync(rule.selector);
        } catch {
          return;
        }
        const subjects = parsed.nodes.map((selector) => {
          const subject: ResponsiveRule['subjects'][number] = { classes: [] };
          for (const node of selector.nodes) {
            if (node.type === 'combinator') {
              subject.tag = undefined;
              subject.id = undefined;
              subject.classes = [];
            } else if (node.type === 'tag') subject.tag = node.value.toLowerCase();
            else if (node.type === 'class') subject.classes.push(node.value);
            else if (node.type === 'id') subject.id = node.value;
          }
          return subject;
        });
        rules.push({ subjects, important: decls.some((d) => d.important) });
      });
    });
  }
  return rules;
}

function matches(el: Element, subject: ResponsiveRule['subjects'][number]): boolean {
  if (subject.tag && subject.tag !== el.tagName) return false;
  if (subject.id && subject.id !== getAttr(el, 'id')?.value) return false;
  const classes = (getAttr(el, 'class')?.value ?? '').split(/\s+/);
  return subject.classes.every((c) => classes.includes(c));
}

interface FixedWidth {
  width: number;
  source: 'attribute' | 'style';
  loc?: SourceLocation;
}

/** The element's fixed width, unless its own inline style already lets it shrink. */
function fixedWidth(ctx: StageContext, el: Element, viewport: number): FixedWidth | null {
  let style: FixedWidth | null = null;
  for (const sheet of ctx.sheets) {
    if (sheet.source.kind !== 'inline' || sheet.source.element !== el) continue;
    for (const d of sheet.declarations) {
      if (d.expandedFrom) continue;
      if (fits(d.decl, viewport)) return null; // e.g. max-width:100% or width:100%
      if (d.prop === 'width') {
        const px = toPx(d.value);
        if (px !== null) style = { width: px, source: 'style', loc: d.loc };
      }
    }
  }
  if (style) return style;
  const attr = getAttr(el, 'width');
  const px = attr && /^\s*\d+(\.\d+)?\s*(px)?\s*$/i.test(attr.value) ? toPx(attr.value) : null;
  return px === null ? null : { width: px, source: 'attribute', loc: attrLoc(el, 'width') };
}

export function checkMobileFit(ctx: StageContext): void {
  if (ctx.profile.device !== 'mobile') return;
  const viewport = ctx.render.viewportWidth;
  const rules = responsiveRules(ctx, viewport);
  const flagged = new Set<Node>();

  walkElements(ctx.parsed.document, (el, parent) => {
    // Report only the outermost element that overflows.
    if (flagged.has(parent)) {
      flagged.add(el);
      return;
    }
    if (!SIZED_TAGS.has(el.tagName)) return;
    const fixed = fixedWidth(ctx, el, viewport);
    if (!fixed || fixed.width <= viewport) return;
    const resized = rules.some(
      (r) => (fixed.source === 'attribute' || r.important) && r.subjects.some((s) => matches(el, s)),
    );
    if (resized) return;

    flagged.add(el);
    const what = fixed.source === 'attribute' ? `width="${fixed.width}"` : `width:${fixed.width}px`;
    ctx.mutations.push({
      client: ctx.clientId,
      stage: 'quirk',
      action: 'warn-only',
      target: { loc: fixed.loc ?? elementLoc(el), element: el.tagName, property: 'width', value: String(fixed.width) },
      feature: 'quirk-mobile-fixed-width',
      severity: 'warning',
      reason:
        `<${el.tagName}> has a fixed \`${what}\`, wider than a ${viewport}px phone screen, and no ` +
        `@media rule that ${ctx.profile.name} applies at this width resizes it` +
        (fixed.source === 'style' ? ' with !important (needed to override an inline style)' : '') +
        '. The email scrolls sideways or is scaled down as a whole.',
      evidence: FIT_DOC,
      fix:
        'Add a rule such as `@media (max-width: 600px) { .container { width: 100% !important; } }`, ' +
        'or give the element `width:100%; max-width:600px` instead of a fixed width.',
    });
  });
}

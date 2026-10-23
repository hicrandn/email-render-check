// Rule half of the CSS filter: checks at-rules (@media and its media features,
// @font-face, @import, @keyframes, @supports), selectors, CSS nesting and CSS
// comments against caniemail.
//
//   n (unsupported) -> remove-rule; an at-rule goes with everything inside it,
//                      a selector is dropped from its rule's selector list
//                      (the rule goes once no selector is left).
//   a (partial)     -> judged against the client's notes (partial.ts):
//                      removed when outside what the client supports, kept
//                      silently when inside it, warn-only otherwise.
//
// Runs before the declaration pass, so declarations inside a removed rule
// are not checked or reported.
import valueParser from 'postcss-value-parser';
import selectorParser from 'postcss-selector-parser';
import type { AtRule, Comment, Rule } from 'postcss';
import type { Mutation } from '../types';
import { featureBySlug } from '../data/snapshot';
import { cssNodeLoc, isAttached, type StyleSheet } from '../parse/css';
import type { StageContext } from './context';
import { judgeMedia, judgeSelector, nestingFlattens, type SelectorSubject } from './partial';

export const AT_RULE_SLUG: Record<string, string> = {
  media: 'css-at-media',
  'font-face': 'css-at-font-face',
  import: 'css-at-import',
  keyframes: 'css-at-keyframes',
  '-webkit-keyframes': 'css-at-keyframes',
  supports: 'css-at-supports',
};

/** Media features that caniemail tracks separately from @media itself. */
function mediaFeatureSlug(name: string): string | undefined {
  if (name === 'prefers-color-scheme') return 'css-at-media-prefers-color-scheme';
  if (name === 'prefers-reduced-motion') return 'css-at-media-prefers-reduced-motion';
  if (name === 'hover' || name === 'any-hover') return 'css-at-media-hover';
  if (name === 'orientation') return 'css-at-media-orientation';
  // device-pixel-ratio with any vendor / min- / max- prefix.
  if (name.endsWith('device-pixel-ratio')) return 'css-at-media-device-pixel-ratio';
  return undefined;
}

/** Feature names in a media query: `(name: value)` parses as an unnamed function. */
function mediaFeatures(params: string): string[] {
  const names: string[] = [];
  valueParser(params).walk((node) => {
    if (node.type !== 'function' || node.value !== '') return;
    const first = node.nodes.find((n) => n.type === 'word');
    if (first) names.push(first.value.toLowerCase());
  });
  return names;
}

/** Slugs to check for an at-rule, most specific first. */
function slugsFor(at: AtRule): string[] {
  const name = at.name.toLowerCase();
  const slugs: string[] = [];
  if (name === 'media') {
    for (const feature of mediaFeatures(at.params)) {
      const slug = mediaFeatureSlug(feature);
      if (slug && !slugs.includes(slug)) slugs.push(slug);
    }
  }
  const slug = AT_RULE_SLUG[name];
  if (slug) slugs.push(slug);
  return slugs;
}

// Pseudo-elements that also accept the legacy single-colon syntax.
const LEGACY_PSEUDO_ELEMENTS = new Set(['before', 'after', 'first-letter', 'first-line']);

const COMBINATOR_SLUG: Record<string, string> = {
  '>': 'css-selector-child',
  '+': 'css-selector-adjacent-sibling',
  '~': 'css-selector-general-sibling',
  '': 'css-selector-descendant',
};

/**
 * caniemail slugs a single selector (one entry of a selector list) relies on,
 * with what partial.ts needs to judge a pseudo-class or attribute selector in
 * the compound it sits in (`a:hover`, `td[class]`).
 */
function selectorSlugs(selector: selectorParser.Selector): Map<string, SelectorSubject | undefined> {
  const slugs = new Map<string, SelectorSubject | undefined>();
  const add = (slug: string, subject?: SelectorSubject) => {
    if (!slugs.has(slug)) slugs.set(slug, subject);
  };
  // Top-level compounds; a pseudo-class's own arguments (`:not(.x)`) are not one.
  const subjects = new Map<selectorParser.Node, SelectorSubject>();
  let compound: selectorParser.Node[] = [];
  const close = () => {
    const hasType = compound.some((n) => n.type === 'tag');
    const withClass = compound.some((n) => n.type === 'class');
    for (const n of compound) {
      if (n.type === 'pseudo') subjects.set(n, { hasType });
      if (n.type === 'attribute') {
        subjects.set(n, { hasType, operator: n.operator ?? '', attribute: n.attribute.toLowerCase(), withClass });
      }
    }
    compound = [];
  };
  for (const node of selector.nodes) {
    if (node.type === 'combinator') close();
    else compound.push(node);
  }
  close();

  selector.walk((node) => {
    switch (node.type) {
      case 'combinator': {
        const slug = COMBINATOR_SLUG[node.value.trim()];
        if (slug) add(slug);
        break;
      }
      case 'universal':
        add('css-selector-universal');
        break;
      case 'attribute':
        add('css-selector-attribute', subjects.get(node));
        break;
      case 'class':
        add('css-selector-class');
        break;
      case 'id':
        add('css-selector-id');
        break;
      case 'tag':
        add('css-selector-type');
        break;
      case 'pseudo': {
        const name = node.value.replace(/^:+/, '').toLowerCase();
        const element = node.value.startsWith('::') || LEGACY_PSEUDO_ELEMENTS.has(name);
        add(`css-pseudo-${element ? 'element' : 'class'}-${name}`, subjects.get(node));
        break;
      }
    }
  });
  // Chaining is two or more classes/ids on one element (`.foo.bar`).
  let chained = 0;
  for (const node of selector.nodes) {
    if (node.type === 'combinator') chained = 0;
    else if (node.type === 'class' || node.type === 'id') chained++;
    if (chained >= 2) add('css-selector-chaining');
  }
  return slugs;
}

function insideMedia(at: AtRule): boolean {
  for (let p = at.parent; p; p = p.parent as AtRule['parent']) {
    if (p.type === 'atrule' && (p as AtRule).name.toLowerCase() === 'media') return true;
  }
  return false;
}

function insideKeyframes(rule: Rule): boolean {
  for (let p: Rule['parent'] | undefined = rule.parent; p; p = p.parent as Rule['parent']) {
    if (p.type === 'atrule' && /keyframes$/i.test((p as AtRule).name)) return true;
  }
  return false;
}

export function runCssRuleFilter(ctx: StageContext): void {
  for (const sheet of ctx.sheets) {
    checkComments(ctx, sheet);
    if (sheet.source.kind !== 'block') continue;
    const atRules: AtRule[] = [];
    sheet.root.walkAtRules((at) => {
      atRules.push(at);
    });
    for (const at of atRules) {
      if (!isAttached(sheet, at)) continue; // inside an at-rule removed above
      checkAtRule(ctx, sheet, at);
    }

    const rules: Rule[] = [];
    sheet.root.walkRules((rule) => {
      if (!insideKeyframes(rule)) rules.push(rule);
    });
    for (const rule of rules) {
      if (!isAttached(sheet, rule)) continue;
      // Yahoo drops a nested selector but keeps its declarations, which then
      // apply to the parent selector.
      const flatten = nestingFlattens(featureBySlug.get('css-nesting')!.support[ctx.clientId]);
      if (rule.parent?.type === 'rule' && !checkSlug(ctx, sheet, rule, 'css-nesting', rule.selector,
        flatten ? 'Its declarations apply to the parent selector instead.' : undefined)) {
        if (flatten) rule.replaceWith(...(rule.nodes ?? []).filter((n) => n.type === 'decl'));
        else rule.remove();
        sheet.dirty = true;
        continue;
      }
      checkSelectors(ctx, sheet, rule);
    }
  }
}

/** CSS comments, in <style> blocks and style attributes alike. */
function checkComments(ctx: StageContext, sheet: StyleSheet): void {
  const feature = featureBySlug.get('css-comments');
  if (!feature) return;
  const support = feature.support[ctx.clientId];
  if (support.status !== 'n' && support.status !== 'a') return;
  const comments: Comment[] = [];
  sheet.root.walkComments((c) => {
    comments.push(c);
  });
  for (const comment of comments) {
    const removed = support.status === 'n';
    ctx.mutations.push({
      client: ctx.clientId,
      stage: 'css-filter',
      action: removed ? 'rewrite' : 'warn-only',
      target: { loc: cssNodeLoc(sheet, ctx.parsed.lineIndex, comment), selector: '/* … */' },
      feature: 'css-comments',
      severity: removed ? 'error' : 'warning',
      reason:
        (removed
          ? `${ctx.profile.name} does not support CSS comments; the comment was removed.`
          : `${ctx.profile.name} has partial support for CSS comments. The comment was kept.`) +
        notes(support.notes),
      evidence: feature.url,
    });
    if (removed) {
      comment.remove();
      sheet.dirty = true;
    }
  }
}

/**
 * Report one slug for a rule. Returns false when the client does not support
 * it (or, for partial support, not in this form); the caller decides what to
 * drop.
 */
function checkSlug(
  ctx: StageContext,
  sheet: StyleSheet,
  rule: Rule,
  slug: string,
  selector: string,
  dropping = 'The rule was removed.',
  subject?: SelectorSubject,
): boolean {
  const feature = featureBySlug.get(slug);
  if (!feature) return true;
  const support = feature.support[ctx.clientId];
  const loc = cssNodeLoc(sheet, ctx.parsed.lineIndex, rule);
  // Without a subject (class, id, combinators) only notes that need none apply.
  const judged = support.status === 'a' ? judgeSelector(support, subject ?? { hasType: true }) : undefined;
  if (support.status === 'n' || judged?.kind === 'remove') {
    const why = judged?.kind === 'remove'
      ? `supports ${feature.title} only in part: ${judged.why}`
      : `does not support ${feature.title}`;
    ctx.mutations.push({
      client: ctx.clientId,
      stage: 'css-filter',
      action: 'remove-rule',
      target: { loc, selector },
      feature: slug,
      severity: 'error',
      reason:
        `${ctx.profile.name} ${why}, so \`${selector}\` never matches. ${dropping}` +
        notes(support.notes),
      evidence: feature.url,
    });
    return false;
  }
  if (support.status === 'a' && judged?.kind !== 'ok') {
    ctx.mutations.push({
      client: ctx.clientId,
      stage: 'css-filter',
      action: 'warn-only',
      target: { loc, selector },
      feature: slug,
      severity: 'warning',
      reason:
        `${ctx.profile.name} has partial support for ${feature.title}. \`${selector}\` was ` +
        `kept.` + notes(support.notes),
      evidence: feature.url,
    });
  }
  return true;
}

function checkSelectors(ctx: StageContext, sheet: StyleSheet, rule: Rule): void {
  let parsed: selectorParser.Root;
  try {
    parsed = selectorParser().astSync(rule.selector);
  } catch {
    return; // malformed selector: leave it to the client
  }
  const selectors = parsed.nodes;
  const kept: string[] = [];
  for (const selector of selectors) {
    const text = selector.toString().trim();
    const others = selectors.length > 1;
    let supported = true;
    for (const [slug, subject] of selectorSlugs(selector)) {
      // Report only the first unsupported slug; the selector is gone after it.
      if (!checkSlug(ctx, sheet, rule, slug, text, others
        ? 'It was dropped from the selector list; the other selectors still apply.'
        : undefined, subject)) {
        supported = false;
        break;
      }
    }
    if (supported) kept.push(text);
  }
  if (kept.length === selectors.length) return;
  if (kept.length === 0) rule.remove();
  else rule.selector = kept.join(', ');
  sheet.dirty = true;
}

function checkAtRule(ctx: StageContext, sheet: StyleSheet, at: AtRule): void {
  const rule = `@${at.name} ${at.params}`.trim();
  const warns: Mutation[] = [];
  for (const slug of slugsFor(at)) {
    const feature = featureBySlug.get(slug);
    if (!feature) continue;
    const support = feature.support[ctx.clientId];
    if (support.status === 'n') {
      ctx.mutations.push(
        mutation(ctx, sheet, at, slug, feature.url, 'remove-rule', 'error',
          `${ctx.profile.name} does not support ${feature.title}. The \`${rule}\` rule was ` +
            `removed with everything inside it.` + notes(support.notes)),
      );
      at.remove();
      sheet.dirty = true;
      return;
    }
    const judged = slug === 'css-at-media' && support.status === 'a'
      ? judgeMedia(support, at.params, insideMedia(at))
      : undefined;
    if (judged?.kind === 'remove') {
      ctx.mutations.push(
        mutation(ctx, sheet, at, slug, feature.url, 'remove-rule', 'error',
          `${ctx.profile.name} supports ${feature.title} only in part: ${judged.why}. The ` +
            `\`${rule}\` rule was removed with everything inside it.` + notes(support.notes)),
      );
      at.remove();
      sheet.dirty = true;
      return;
    }
    if (support.status === 'a' && judged?.kind !== 'ok') {
      warns.push(
        mutation(ctx, sheet, at, slug, feature.url, 'warn-only', 'warning',
          `${ctx.profile.name} has partial support for ${feature.title}. The \`${rule}\` ` +
            `rule was kept.` + notes(support.notes)),
      );
    }
  }
  ctx.mutations.push(...warns);
}

function mutation(
  ctx: StageContext,
  sheet: StyleSheet,
  at: AtRule,
  slug: string,
  evidence: string,
  action: Mutation['action'],
  severity: Mutation['severity'],
  reason: string,
): Mutation {
  return {
    client: ctx.clientId,
    stage: 'css-filter',
    action,
    target: { loc: cssNodeLoc(sheet, ctx.parsed.lineIndex, at), selector: `@${at.name} ${at.params}`.trim() },
    feature: slug,
    severity,
    reason,
    evidence,
  };
}

function notes(list: string[]): string {
  return list.length ? ` Notes: ${list.join(' ')}` : '';
}

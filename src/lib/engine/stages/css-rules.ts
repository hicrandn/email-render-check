// At-rule half of the CSS filter: checks @media (and its media features),
// @font-face, @import, @keyframes and @supports against caniemail.
//
//   n (unsupported) -> remove-rule; the at-rule and everything inside it go.
//   a (partial)     -> warn-only; the at-rule stays, notes appended.
//
// Runs before the declaration pass, so declarations inside a removed at-rule
// are not checked or reported.
import valueParser from 'postcss-value-parser';
import type { AtRule } from 'postcss';
import type { Mutation } from '../types';
import { featureBySlug } from '../data/snapshot';
import { cssNodeLoc, isAttached, type StyleSheet } from '../parse/css';
import type { StageContext } from './context';

const AT_RULE_SLUG: Record<string, string> = {
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

export function runCssRuleFilter(ctx: StageContext): void {
  for (const sheet of ctx.sheets) {
    if (sheet.source.kind !== 'block') continue;
    const atRules: AtRule[] = [];
    sheet.root.walkAtRules((at) => {
      atRules.push(at);
    });
    for (const at of atRules) {
      if (!isAttached(sheet, at)) continue; // inside an at-rule removed above
      checkAtRule(ctx, sheet, at);
    }
  }
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
    if (support.status === 'a') {
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

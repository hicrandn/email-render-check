// CSS filter stage: matches every parsed declaration against the client's
// caniemail support status via the slug map. At-rules are checked first, in
// css-rules.ts.
//
//   n (unsupported) -> remove-property / remove-value; the declaration (or the
//                      offending token) is actually removed from the output.
//   a (partial)     -> judged against the client's notes (partial.ts): kept
//                      silently when inside what the client supports,
//                      removed or rewritten when outside it, and kept with a
//                      warning when the notes can't be checked.
//
// Value-level matches only affect that value: `display:flex` is removed for
// outlook-win, but `display:block` is untouched.
import { list } from 'postcss';
import valueParser from 'postcss-value-parser';
import type { ClientId, Mutation, MutationAction, Severity } from '../types';
import { featureBySlug } from '../data/snapshot';
import {
  SLUG_MAP,
  CUSTOM_PROPERTY_SLUG,
  IMPORTANT_SLUG,
  type KeywordMapping,
  type SlugMapping,
} from '../data/slug-map';
import { isAttached, removeTokenFromDecl, type ParsedDeclaration } from '../parse/css';
import type { StageContext } from './context';
import { runCssRuleFilter } from './css-rules';
import { judgeDeclaration, judgeImportant, type Judgement } from './partial';

interface ValueAnalysis {
  keywords: Set<string>;
  functions: Set<string>;
  units: Set<string>;
}

function analyzeValue(value: string): ValueAnalysis {
  const keywords = new Set<string>();
  const functions = new Set<string>();
  const units = new Set<string>();
  const parsed = valueParser(value);
  parsed.walk((node) => {
    if (node.type === 'function') {
      if (node.value) functions.add(node.value.toLowerCase());
    } else if (node.type === 'word') {
      const w = node.value.toLowerCase();
      keywords.add(w);
      const dim = valueParser.unit(node.value);
      if (dim && dim.unit) units.add(dim.unit.toLowerCase());
    }
  });
  return { keywords, functions, units };
}

/** A candidate match between a declaration and a caniemail slug. */
interface Match {
  slug: string;
  /** How to act if the slug is unsupported. */
  kind: SlugMapping['kind'] | 'important';
}

function findMatches(decl: ParsedDeclaration, analysis: ValueAnalysis): Match[] {
  const matches: Match[] = [];

  // Value-level (checked first: most specific).
  for (const m of SLUG_MAP.valueMappings) {
    if (m.property !== decl.prop) continue;
    if (m.values.some((v) => analysis.keywords.has(v.toLowerCase()))) {
      matches.push({ slug: m.slug, kind: 'value' });
    }
  }
  // Function-level (calc, gradients, color functions).
  for (const m of SLUG_MAP.functionMappings) {
    if (m.functions.some((f) => analysis.functions.has(f.toLowerCase()))) {
      matches.push({ slug: m.slug, kind: 'function' });
    }
  }
  // Unit-level.
  for (const m of SLUG_MAP.unitMappings) {
    if (m.units.some((u) => analysis.units.has(u.toLowerCase()))) {
      matches.push({ slug: m.slug, kind: 'unit' });
    }
  }
  // Keyword-level (e.g. fit-content in any property).
  for (const m of SLUG_MAP.keywordMappings) {
    if (m.keywords.some((k) => analysis.keywords.has(k))) {
      matches.push({ slug: m.slug, kind: 'keyword' });
    }
  }
  // Property-level (least specific; still relevant even if a value matched).
  // A longhand expanded from a shorthand covered by the same slug was already
  // checked as the shorthand itself.
  const shorthandSlugs = new Set(
    (decl.expandedFrom ? SLUG_MAP.byProperty.get(decl.expandedFrom) ?? [] : []).map((m) => m.slug),
  );
  for (const m of SLUG_MAP.byProperty.get(decl.prop) ?? []) {
    if (!shorthandSlugs.has(m.slug)) matches.push({ slug: m.slug, kind: 'property' });
  }
  if (decl.prop.startsWith('--')) matches.push({ slug: CUSTOM_PROPERTY_SLUG, kind: 'property' });
  // Expanded longhands share their shorthand's flag; report it once.
  if (decl.important && !decl.expandedFrom) matches.push({ slug: IMPORTANT_SLUG, kind: 'important' });

  return matches;
}

export function runCssFilter(ctx: StageContext): void {
  const { clientId } = ctx;
  runCssRuleFilter(ctx);
  // Declarations removed as whole nodes; skip token-level edits against them.
  const removed = new WeakSet<object>();

  for (const sheet of ctx.sheets) {
    const dropped = new Set<ParsedDeclaration>();
    for (const decl of sheet.declarations) {
      if (!isAttached(sheet, decl.decl)) continue;
      const analysis = analyzeValue(decl.value);
      const matches = findMatches(decl, analysis);
      const subject = {
        prop: decl.prop,
        value: decl.value,
        element: decl.origin === 'inline' ? decl.element.tagName : undefined,
      };

      let handled = false;
      const warns: Mutation[] = [];

      for (const match of matches) {
        const feature = featureBySlug.get(match.slug);
        if (!feature) continue;
        const support = feature.support[clientId];
        if (support.status !== 'n' && support.status !== 'a') continue;

        // The important flag is judged by its spelling; the other notes are about values.
        const judged = match.kind === 'important'
          ? judgeImportant(support, (decl.decl.raws.important ?? '!important').trim(), decl.origin === 'inline')
          : judgeDeclaration(support, subject);
        if (judged && judged.kind !== 'ok' && judged.kind !== 'warn') {
          const gone = applyJudgement(ctx, sheet, decl, match, feature, judged, removed);
          if (gone) dropped.add(decl);
          handled = gone || judged.kind === 'rewrite';
          if (handled) break;
          continue;
        }
        if (support.status === 'n') {
          if (applyRemoval(ctx, sheet, decl, match, feature, removed)) dropped.add(decl);
          handled = true;
          break; // first unsupported match wins; the declaration is gone.
        }
        if (judged?.kind === 'ok') continue;
        warns.push(
          buildMutation(clientId, decl, match, feature, 'warn-only', 'warning',
            `${ctx.profile.name} has partial support for ${feature.title}. ` +
              `The declaration was kept.` + notes(support.notes)),
        );
      }

      if (!handled) {
        // No removal — surface any partial-support warnings (deduped by slug).
        const seen = new Set<string>();
        for (const w of warns) {
          if (seen.has(w.feature)) continue;
          seen.add(w.feature);
          ctx.mutations.push(w);
        }
      }
      if (sheet.stripped) break;
    }
    // Later stages only see what the client kept.
    sheet.declarations = sheet.stripped
      ? []
      : sheet.declarations.filter((d) => !dropped.has(d) && isAttached(sheet, d.decl));
  }
}

/**
 * Act on a partial-support judgement other than ok/warn. Returns true when the
 * declaration is gone from the output.
 */
function applyJudgement(
  ctx: StageContext,
  sheet: ParsedDeclaration['sheet'],
  decl: ParsedDeclaration,
  match: Match,
  feature: NonNullable<ReturnType<typeof featureBySlug.get>>,
  judged: Exclude<Judgement, { kind: 'ok' | 'warn' }>,
  removed: WeakSet<object>,
): boolean {
  const support = feature.support[ctx.clientId];
  const what = `\`${decl.prop}: ${decl.value}\``;
  const said = `${ctx.profile.name} supports ${feature.title} only in part: ${judged.why}.`;
  switch (judged.kind) {
    case 'remove':
      if (decl.removeToken) return applyRemoval(ctx, sheet, decl, match, feature, removed);
      if (!removed.has(decl.decl)) {
        decl.decl.remove();
        removed.add(decl.decl);
        sheet.dirty = true;
      }
      ctx.mutations.push(
        buildMutation(ctx.clientId, decl, match, feature, 'remove-property', 'error',
          `${said} ${what} was removed from the output.` + notes(support.notes)),
      );
      return true;
    case 'rewrite': {
      // A longhand derived from a shorthand can't be rewritten on its own.
      if (decl.expandedFrom) return false;
      decl.decl.prop = judged.prop;
      decl.decl.value = judged.value;
      sheet.dirty = true;
      ctx.mutations.push(
        // An unsupported feature the client turns into something else is an
        // error like any removal; a partial one rendered differently is not.
        buildMutation(ctx.clientId, decl, match, feature, 'rewrite',
          support.status === 'n' ? 'error' : 'warning',
          `${ctx.profile.name}: ${judged.why}, so ${what} renders as ` +
            `\`${judged.prop}: ${judged.value}\`.` + notes(support.notes)),
      );
      return false;
    }
    case 'strip-attribute':
      sheet.root.removeAll();
      sheet.dirty = true;
      ctx.mutations.push(
        buildMutation(ctx.clientId, decl, match, feature, 'remove-attribute', 'error',
          `${ctx.profile.name}: ${judged.why}. The \`style\` attribute on <${decl.element.tagName}> ` +
            `was removed, with every declaration in it.` + notes(support.notes)),
      );
      return true;
    case 'strip-block':
      sheet.root.removeAll();
      sheet.dirty = true;
      sheet.stripped = true;
      ctx.mutations.push(
        buildMutation(ctx.clientId, decl, match, feature, 'remove-element', 'error',
          `${ctx.profile.name}: ${judged.why}. The whole <style> element was removed, with ` +
            `every rule in it.` + notes(support.notes)),
      );
      return true;
  }
}

function applyRemoval(
  ctx: StageContext,
  sheet: ParsedDeclaration['sheet'],
  decl: ParsedDeclaration,
  match: Match,
  feature: NonNullable<ReturnType<typeof featureBySlug.get>>,
  removed: WeakSet<object>,
): boolean {
  const support = feature.support[ctx.clientId];

  // Value-level removal inside a shorthand (e.g. background-image token).
  if (decl.removeToken) {
    if (!removed.has(decl.removeToken.parentDecl)) {
      const ok = removeTokenFromDecl(decl.removeToken);
      if (ok) {
        sheet.dirty = true;
        if (decl.removeToken.parentDecl.value.trim() === '') {
          decl.removeToken.parentDecl.remove();
          removed.add(decl.removeToken.parentDecl);
        }
      }
    }
    ctx.mutations.push(
      buildMutation(ctx.clientId, decl, match, feature, 'remove-value', 'error',
        removalReason(ctx, feature, support.notes, decl)),
    );
    return true;
  }

  // An unsupported family in a font-family list: drop just that family, the
  // client falls through to the next one.
  if (match.kind === 'keyword' && decl.prop === 'font-family' && !decl.expandedFrom) {
    const { keywords } = SLUG_MAP.bySlug.get(match.slug) as KeywordMapping;
    const families = list.comma(decl.value);
    const kept = families.filter((f) => !keywords.includes(f.toLowerCase()));
    if (kept.length > 0 && kept.length < families.length) {
      const dropped = families.filter((f) => !kept.includes(f));
      decl.decl.value = kept.join(', ');
      decl.value = decl.decl.value;
      sheet.dirty = true;
      ctx.mutations.push(
        buildMutation(ctx.clientId, decl, match, feature, 'remove-value', 'error',
          `${ctx.profile.name} does not support ${feature.title}. \`${dropped.join(', ')}\` was ` +
            `removed from \`font-family\`, so the next family in the list is used.` +
            notes(support.notes)),
      );
      return false; // the declaration stays, with a shorter list
    }
  }

  // Whole-declaration removal (property-level, or a value that is the whole value).
  if (!removed.has(decl.decl)) {
    decl.decl.remove();
    removed.add(decl.decl);
    sheet.dirty = true;
  }
  const action: MutationAction =
    match.kind === 'value' || match.kind === 'keyword' ? 'remove-value' : 'remove-property';
  ctx.mutations.push(
    buildMutation(ctx.clientId, decl, match, feature, action, 'error',
      removalReason(ctx, feature, support.notes, decl)),
  );
  return true;
}

function removalReason(
  ctx: StageContext,
  feature: NonNullable<ReturnType<typeof featureBySlug.get>>,
  noteList: string[],
  decl: ParsedDeclaration,
): string {
  const via = decl.expandedFrom
    ? ` (derived from the \`${decl.expandedFrom}\` shorthand)`
    : '';
  return (
    `${ctx.profile.name} does not support ${feature.title}${via}. ` +
    `\`${decl.prop}: ${decl.value}\` was removed from the output.` + notes(noteList)
  );
}

function buildMutation(
  client: ClientId,
  decl: ParsedDeclaration,
  match: Match,
  feature: NonNullable<ReturnType<typeof featureBySlug.get>>,
  action: MutationAction,
  severity: Severity,
  reason: string,
): Mutation {
  return {
    client,
    stage: 'css-filter',
    action,
    target: {
      loc: decl.loc,
      selector: decl.selector,
      element: decl.element.tagName,
      property: decl.prop,
      value: decl.value,
    },
    feature: match.slug,
    severity,
    reason,
    evidence: feature.url,
  };
}

function notes(list: string[]): string {
  return list.length ? ` Notes: ${list.join(' ')}` : '';
}

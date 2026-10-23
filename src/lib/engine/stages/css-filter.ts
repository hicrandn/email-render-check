// CSS filter stage: matches every parsed declaration against the client's
// caniemail support status via the slug map.
//
//   n (unsupported) -> remove-property / remove-value; the declaration (or the
//                      offending token) is actually removed from the output.
//   a (partial)     -> warn-only; the declaration stays, notes appended.
//
// Value-level matches only affect that value: `display:flex` is removed for
// outlook-win, but `display:block` is untouched.
import valueParser from 'postcss-value-parser';
import type { ClientId, Mutation, MutationAction, Severity } from '../types';
import { featureBySlug } from '../data/snapshot';
import { SLUG_MAP, type SlugMapping } from '../data/slug-map';
import { removeTokenFromDecl, type ParsedDeclaration } from '../parse/css';
import type { StageContext } from './context';

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
  kind: SlugMapping['kind'];
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

  return matches;
}

export function runCssFilter(ctx: StageContext): void {
  const { clientId } = ctx;
  // Declarations removed as whole nodes; skip token-level edits against them.
  const removed = new WeakSet<object>();

  for (const sheet of ctx.sheets) {
    for (const decl of sheet.declarations) {
      const analysis = analyzeValue(decl.value);
      const matches = findMatches(decl, analysis);

      let handled = false;
      const warns: Mutation[] = [];

      for (const match of matches) {
        const feature = featureBySlug.get(match.slug);
        if (!feature) continue;
        const support = feature.support[clientId];

        if (support.status === 'n') {
          applyRemoval(ctx, sheet, decl, match, feature, removed);
          handled = true;
          break; // first unsupported match wins; the declaration is gone.
        }
        if (support.status === 'a') {
          warns.push(
            buildMutation(clientId, decl, match, feature, 'warn-only', 'warning',
              `${ctx.profile.name} has partial support for ${feature.title}. ` +
                `The declaration was kept.` + notes(support.notes)),
          );
        }
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
    }
  }
}

function applyRemoval(
  ctx: StageContext,
  sheet: ParsedDeclaration['sheet'],
  decl: ParsedDeclaration,
  match: Match,
  feature: NonNullable<ReturnType<typeof featureBySlug.get>>,
  removed: WeakSet<object>,
): void {
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
    return;
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

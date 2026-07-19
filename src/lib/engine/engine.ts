// The simulation engine. `simulate(html, clientId)` runs a deterministic
// pipeline and produces a single Mutation Log; the output HTML is derived by
// serializing the mutated AST. No DOM, no window, no global/stateful regex —
// everything flows through the parse5 + postcss ASTs.
import type { ClientId, Mutation, MutationStage, SimulationResult } from './types';
import { parseHtml, serializeHtml, collectStyleSources, getAttr } from './parse/html';
import { parseStyleSheet, type StyleSheet } from './parse/css';
import { getProfile } from './profiles';
import type { StageContext } from './stages/context';
import { runSanitize } from './stages/sanitize';
import { runCssFilter } from './stages/css-filter';
import { runInline } from './stages/inline';
import { runDefaults } from './stages/defaults';
import { runQuirks } from './stages/quirks';

const STAGE_ORDER: Record<MutationStage, number> = {
  sanitize: 0,
  'css-filter': 1,
  inline: 2,
  defaults: 3,
  quirk: 4,
};

/** Stable ordering so identical input always yields a byte-identical result. */
function compareMutations(a: Mutation, b: Mutation): number {
  const la = a.target.loc;
  const lb = b.target.loc;
  if (la && lb) {
    if (la.startLine !== lb.startLine) return la.startLine - lb.startLine;
    if (la.startCol !== lb.startCol) return la.startCol - lb.startCol;
  } else if (la) {
    return -1;
  } else if (lb) {
    return 1;
  }
  if (STAGE_ORDER[a.stage] !== STAGE_ORDER[b.stage]) {
    return STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage];
  }
  if (a.action !== b.action) return a.action < b.action ? -1 : 1;
  if (a.feature !== b.feature) return a.feature < b.feature ? -1 : 1;
  const pa = a.target.property ?? '';
  const pb = b.target.property ?? '';
  if (pa !== pb) return pa < pb ? -1 : 1;
  return 0;
}

/** Write mutated stylesheet roots back into their owning AST nodes. */
function writeBack(sheets: StyleSheet[]): void {
  for (const sheet of sheets) {
    if (!sheet.dirty) continue;
    const css = sheet.root.toString().trim();
    if (sheet.source.kind === 'inline') {
      const el = sheet.source.element;
      if (css === '') {
        const idx = el.attrs.findIndex((a) => a.name === 'style');
        if (idx >= 0) el.attrs.splice(idx, 1);
      } else {
        const attr = getAttr(el, 'style');
        if (attr) attr.value = css;
      }
    } else {
      sheet.source.textNode.value = css;
    }
  }
}

export function simulate(html: string, clientId: ClientId): SimulationResult {
  const parsed = parseHtml(html);
  const ctx: StageContext = {
    clientId,
    profile: getProfile(clientId),
    parsed,
    sheets: [],
    mutations: [],
  };

  // 1. sanitize (mutates the element tree first).
  runSanitize(ctx);

  // 2. parse CSS from the sanitized tree, then css-filter.
  const sources = collectStyleSources(parsed);
  ctx.sheets = sources.map((s) => parseStyleSheet(s, parsed.lineIndex));
  runCssFilter(ctx);

  // 3. Phase-3 stubs (no-ops today).
  runInline(ctx);
  runDefaults(ctx);
  runQuirks(ctx);

  // Derive the output HTML from the mutated AST.
  writeBack(ctx.sheets);
  const outHtml = serializeHtml(parsed);

  ctx.mutations.sort(compareMutations);
  return { clientId, html: outHtml, mutations: ctx.mutations };
}

// Dark-mode stage. Runs after `defaults`, before `quirks`. Always declares the
// rendered color scheme; under a dark context it branches on the client's
// DarkModeProfile:
//
//   unsupported (Outlook/Win): render light; emit one info.
//   native / partial (Apple Mail, Outlook.com): apply the author's
//     prefers-color-scheme dark rules if present; otherwise keep light.
//   auto-invert (Gmail, Yahoo): simulate the client's automatic HSL lightness
//     inversion of undeclared colors, and flag the contrast / image failures
//     it causes.
//
// Whether a client honors the color-scheme meta tag is read from caniemail, not
// assumed from the strategy; unsupported @media (prefers-color-scheme) blocks
// are removed earlier by the CSS filter.
import valueParser from 'postcss-value-parser';
import type { SourceLocation } from '../types';
import type { StageContext } from './context';
import { cssNodeLoc, type ParsedDeclaration, type RemoveToken, type StyleSheet } from '../parse/css';
import {
  walkElements,
  elementLoc,
  getAttr,
  isTextNode,
  findElement,
  buildStyleNode,
  prependChild,
  type Element,
  type Node,
  type ChildNode,
  type ParentNode,
} from '../parse/html';
import { contrastRatio, flipLightness, parseColor } from '../color';
import { supportFor } from '../data/snapshot';

const PREFERS_DARK_SLUG = 'css-at-media-prefers-color-scheme';
const META_SLUG = 'html-meta-color-scheme';
const PREFERS_DARK_DOC =
  'https://www.caniemail.com/features/css-at-media-prefers-color-scheme/';
const META_DOC = 'https://www.caniemail.com/features/html-meta-color-scheme/';
const OGSC_DOC =
  'https://www.litmus.com/blog/the-ultimate-guide-to-dark-mode-for-email-marketers';
const CONTRAST_DOC = 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html';

const COLOR_PROPS = new Set(['color', 'background-color', 'border-color']);
const AA_NORMAL = 4.5;

// Browser defaults assumed for an undeclared member of a text/background pair —
// this is what makes the canonical failure (white card flips to black, default
// black text vanishes) detectable.
const DEFAULT_TEXT = '#000000';
const DEFAULT_BG = '#ffffff';

/**
 * True if the element directly or transitively contains non-whitespace text.
 * Iterative (explicit stack) — deeply nested markup can otherwise blow the
 * call stack, same reasoning as `walkElements` in parse/html.ts.
 */
function hasTextContent(node: Node): boolean {
  const stack: Node[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const children = (current as { childNodes?: Node[] }).childNodes;
    if (!children) continue;
    for (const child of children) {
      if (isTextNode(child) && child.value.trim().length > 0) return true;
      stack.push(child);
    }
  }
  return false;
}

function isUninvertible(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'currentcolor' || v === 'inherit') return true;
  const c = parseColor(v);
  return !c || c.a === 0;
}

/** Replace one token inside a shorthand value (e.g. the color in `background`). */
function rewriteToken(token: RemoveToken, newText: string): void {
  const parsed = valueParser(token.parentDecl.value);
  for (const node of parsed.nodes) {
    if (node.sourceIndex === token.sourceIndex) {
      node.type = 'word';
      node.value = newText;
      (node as { nodes?: unknown }).nodes = undefined;
      break;
    }
  }
  token.parentDecl.value = valueParser.stringify(parsed.nodes);
}

// --- author dark-style detection -------------------------------------------

interface DarkMedia {
  sheet: StyleSheet;
  at: import('postcss').AtRule;
}

function collectPrefersDark(ctx: StageContext): DarkMedia[] {
  const out: DarkMedia[] = [];
  for (const sheet of ctx.sheets) {
    if (sheet.source.kind !== 'block') continue;
    sheet.root.walkAtRules('media', (at) => {
      if (/prefers-color-scheme\s*:\s*dark/i.test(at.params)) out.push({ sheet, at });
    });
  }
  return out;
}

function hasOgsc(ctx: StageContext): boolean {
  for (const sheet of ctx.sheets) {
    if (sheet.source.kind !== 'block') continue;
    let found = false;
    sheet.root.walkRules((rule) => {
      if (/\[data-ogs[cb]\]/i.test(rule.selector)) found = true;
    });
    if (found) return true;
  }
  return false;
}

/**
 * Declare the scheme the simulated client renders under via CSS `color-scheme`,
 * so undeclared backgrounds and form controls follow it instead of the host
 * browser's own preference. Runs for light renders too. Not logged as a mutation.
 */
function hintColorScheme(ctx: StageContext, scheme: 'light' | 'dark'): void {
  const doc = ctx.parsed.document;
  const host: ParentNode =
    findElement(doc, 'head') ?? findElement(doc, 'body') ?? findElement(doc, 'html') ?? doc;
  const style = buildStyleNode(`:root{color-scheme:${scheme}}`, [
    { name: 'data-color-scheme-hint', value: ctx.clientId },
  ]);
  prependChild(host, style as unknown as ChildNode);
}

function hasColorSchemeMeta(ctx: StageContext): boolean {
  let found = false;
  walkElements(ctx.parsed.document, (el) => {
    if (el.tagName !== 'meta') return;
    const name = getAttr(el, 'name')?.value?.toLowerCase();
    if (name !== 'color-scheme' && name !== 'supported-color-schemes') return;
    if (/dark/i.test(getAttr(el, 'content')?.value ?? '')) found = true;
  });
  return found;
}

// --- application paths ------------------------------------------------------

/** Hoist the author's `prefers-color-scheme: dark` rules so they always apply. */
function applyPrefersDark(ctx: StageContext, media: DarkMedia[], authorNote: string): void {
  for (const { sheet, at } of media) {
    at.walkDecls((decl) => {
      ctx.mutations.push({
        client: ctx.clientId,
        stage: 'dark-mode',
        action: 'apply-dark-override',
        target: {
          loc: cssNodeLoc(sheet, ctx.parsed.lineIndex, decl),
          property: decl.prop.toLowerCase(),
          value: decl.value,
        },
        feature: 'darkmode-author-override',
        severity: 'info',
        reason: authorNote,
        evidence: PREFERS_DARK_DOC,
      });
    });
    at.replaceWith(...(at.nodes ?? []));
    sheet.dirty = true;
  }
}

interface Pair {
  loc?: SourceLocation;
  colorBefore?: string;
  colorAfter?: string;
  bgBefore?: string;
  bgAfter?: string;
}

/** Simulate a client's automatic HSL lightness inversion of undeclared colors. */
function autoInvert(ctx: StageContext, honorsPrefersDark: boolean): void {
  const pairs = new Map<Element, Pair>();
  let inverted = 0;

  for (const sheet of ctx.sheets) {
    for (const d of sheet.declarations) {
      if (!COLOR_PROPS.has(d.prop)) continue;
      if (isUninvertible(d.value)) continue;
      const after = flipLightness(d.value);
      if (!after) continue;

      applyInverted(d, after);
      sheet.dirty = true;
      inverted++;

      ctx.mutations.push({
        client: ctx.clientId,
        stage: 'dark-mode',
        action: 'auto-invert-color',
        target: { loc: d.loc, element: d.element.tagName, property: d.prop, value: d.value },
        feature: 'darkmode-auto-invert',
        severity: 'warning',
        reason:
          `${ctx.profile.name} auto-inverts undeclared colors in dark mode: ` +
          `\`${d.prop}: ${d.value}\` was rendered as \`${after}\` (lightness flipped, hue kept).`,
        evidence: PREFERS_DARK_DOC,
        fix: honorsPrefersDark
          ? 'Add an @media (prefers-color-scheme: dark) block to set these colors ' +
            'explicitly instead of letting the client invert them.'
          : `${ctx.profile.name} ignores @media (prefers-color-scheme: dark), so pick ` +
            'colors that stay readable when their lightness is flipped.',
      });

      // Track color/background pairs on the same element (inline only) for contrast.
      if (d.origin === 'inline' && (d.prop === 'color' || d.prop === 'background-color')) {
        const p = pairs.get(d.element) ?? { loc: d.loc };
        if (d.prop === 'color') {
          p.colorBefore = d.value;
          p.colorAfter = after;
        } else {
          p.bgBefore = d.value;
          p.bgAfter = after;
        }
        pairs.set(d.element, p);
      }
    }
  }

  if (inverted === 0) return;
  flagContrastRegressions(ctx, pairs);
  flagImageInversion(ctx);
}

function applyInverted(d: ParsedDeclaration, after: string): void {
  if (d.expandedFrom) {
    // Virtual longhand from a shorthand — rewrite just the color token.
    if (d.removeToken) rewriteToken(d.removeToken, after);
  } else {
    d.decl.value = after;
  }
}

function flagContrastRegressions(ctx: StageContext, pairs: Map<Element, Pair>): void {
  for (const [el, p] of pairs) {
    if (!hasTextContent(el)) continue; // no text → no readability concern

    // An undeclared member keeps its browser default and is NOT inverted; a
    // declared member uses its before/after values.
    const textBefore = parseColor(p.colorBefore ?? DEFAULT_TEXT);
    const textAfter = parseColor(p.colorAfter ?? p.colorBefore ?? DEFAULT_TEXT);
    const bgBefore = parseColor(p.bgBefore ?? DEFAULT_BG);
    const bgAfter = parseColor(p.bgAfter ?? p.bgBefore ?? DEFAULT_BG);
    if (!textBefore || !textAfter || !bgBefore || !bgAfter) continue;

    const before = contrastRatio(textBefore, bgBefore);
    const after = contrastRatio(textAfter, bgAfter);
    if (before >= AA_NORMAL && after < AA_NORMAL) {
      ctx.mutations.push({
        client: ctx.clientId,
        stage: 'dark-mode',
        action: 'auto-invert-color',
        target: {
          loc: p.loc ?? elementLoc(el),
          element: el.tagName,
          property: 'color',
          value: `${p.colorAfter ?? p.colorBefore ?? DEFAULT_TEXT} on ${p.bgAfter ?? p.bgBefore ?? DEFAULT_BG}`,
        },
        feature: 'darkmode-contrast',
        severity: 'error',
        reason:
          `After ${ctx.profile.name}'s dark-mode inversion, the text/background pair on ` +
          `<${el.tagName}> drops to ${after.toFixed(2)}:1 (was ${before.toFixed(2)}:1), below ` +
          `the WCAG AA minimum of 4.5:1 — the text may become unreadable. ` +
          `${p.colorBefore ? '' : 'The text color was undeclared, so it stays dark while the background flips.'}`,
        evidence: CONTRAST_DOC,
        fix: 'Declare explicit dark-mode text AND background colors so the pair stays above 4.5:1.',
      });
    }
  }
}

function flagImageInversion(ctx: StageContext): void {
  const imgs: Element[] = [];
  walkElements(ctx.parsed.document, (el) => {
    if (el.tagName === 'img') imgs.push(el);
  });
  if (imgs.length === 0) return;
  ctx.mutations.push({
    client: ctx.clientId,
    stage: 'dark-mode',
    action: 'auto-invert-color',
    target: { loc: elementLoc(imgs[0]), element: 'img' },
    feature: 'darkmode-image-inversion',
    severity: 'error',
    reason:
      `${ctx.profile.name} inverts background colors in dark mode. ${imgs.length} ` +
      `image${imgs.length === 1 ? '' : 's'} may be affected: a transparent PNG logo sitting on a ` +
      `background that flips to dark can become invisible or gain a jarring halo.`,
    evidence: OGSC_DOC,
    fix: 'Give logos a solid padded background, or use artwork that reads on both light and dark.',
  });
}

/**
 * Outlook.com marks the elements it recolors with data-ogsc / data-ogsb.
 * Marking <body> is enough for the usual `[data-ogsc] .x {}` rules to match.
 */
function applyOgsc(ctx: StageContext): void {
  const body = findElement(ctx.parsed.document, 'body');
  if (!body) return;
  for (const name of ['data-ogsc', 'data-ogsb']) {
    if (!getAttr(body, name)) body.attrs.push({ name, value: '' });
  }
  ctx.mutations.push({
    client: ctx.clientId,
    stage: 'dark-mode',
    action: 'apply-dark-override',
    target: {},
    feature: 'darkmode-ogsc-applied',
    severity: 'info',
    reason:
      `${ctx.profile.name} adds [data-ogsc]/[data-ogsb] attributes in dark mode, so your ` +
      `rules targeting them apply.`,
    evidence: PREFERS_DARK_DOC,
  });
}

// --- entry point ------------------------------------------------------------

export function runDarkMode(ctx: StageContext): void {
  const dm = ctx.profile.darkMode;

  if (ctx.render.colorScheme === 'light') {
    hintColorScheme(ctx, 'light');
    return;
  }

  if (dm.strategy === 'unsupported') {
    hintColorScheme(ctx, 'light');
    ctx.mutations.push({
      client: ctx.clientId,
      stage: 'dark-mode',
      action: 'warn-only',
      target: {},
      feature: 'darkmode-unsupported',
      severity: 'info',
      reason:
        `${ctx.profile.name} has no dark mode: it renders the light design even when the ` +
        `recipient's OS is set to dark. ${dm.note}`,
      evidence: PREFERS_DARK_DOC,
    });
    return;
  }

  // Every other strategy renders under a dark OS setting, so the client's own
  // default background goes dark regardless of what the author declared.
  hintColorScheme(ctx, 'dark');

  // Blocks the client does not support were already removed by the CSS filter.
  const honorsPrefersDark = supportFor(PREFERS_DARK_SLUG, ctx.clientId).status !== 'n';
  const media = collectPrefersDark(ctx);
  const ogsc = dm.supportsOgscHack && hasOgsc(ctx);
  if (ogsc) applyOgsc(ctx);

  if (dm.strategy === 'native' || dm.strategy === 'partial') {
    if (media.length) {
      applyPrefersDark(
        ctx,
        media,
        `${ctx.profile.name} honors @media (prefers-color-scheme: dark); the author's dark ` +
          `declaration was applied.`,
      );
    } else if (ogsc) {
      return; // the author's [data-ogsc] rules are the dark design
    } else if (hasColorSchemeMeta(ctx) && supportFor(META_SLUG, ctx.clientId).status !== 'n') {
      ctx.mutations.push({
        client: ctx.clientId,
        stage: 'dark-mode',
        action: 'warn-only',
        target: {},
        feature: 'darkmode-meta-only',
        severity: 'info',
        reason:
          `${ctx.profile.name} respects your color-scheme meta, but the email declares no ` +
          `@media (prefers-color-scheme: dark) styles, so the light design is kept as-is.`,
        evidence: META_DOC,
      });
    } else {
      ctx.mutations.push({
        client: ctx.clientId,
        stage: 'dark-mode',
        action: 'warn-only',
        target: {},
        feature: 'darkmode-keeps-light',
        severity: 'info',
        reason:
          `${ctx.profile.name} does not force-invert colors. With no ` +
          `@media (prefers-color-scheme: dark) styles, it keeps your light design in dark mode.`,
        evidence: PREFERS_DARK_DOC,
      });
    }
    return;
  }

  // auto-invert (Gmail, Yahoo)
  if (media.length) {
    applyPrefersDark(
      ctx,
      media,
      `${ctx.profile.name} used your @media (prefers-color-scheme: dark) styles instead of ` +
        `auto-inverting.`,
    );
    return;
  }
  if (ogsc) return;
  autoInvert(ctx, honorsPrefersDark);
}

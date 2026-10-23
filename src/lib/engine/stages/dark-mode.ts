// Dark-mode stage. Runs after `defaults`, before `quirks`. Always declares the
// rendered color scheme; under a dark context it branches on the client's
// DarkModeProfile (sources: Litmus' dark mode guide and Can I Email):
//
//   none (Gmail and Yahoo on the web): the light design, as authored.
//   native (Apple Mail): the author's prefers-color-scheme dark rules apply;
//     colors are never changed, but undeclared backgrounds and text follow
//     the dark scheme.
//   partial-invert (Outlook.com, the Outlook apps): light backgrounds are
//     darkened and dark text lightened; dark backgrounds and light text stay.
//   full-invert (the Gmail apps, Outlook on Windows): every color's lightness
//     is flipped.
//
// Inverting clients that honor prefers-color-scheme (Outlook.com) also apply
// the author's dark rules, on top of their own recoloring. Whether a client
// honors prefers-color-scheme or the color-scheme meta is read from Can I
// Email; unsupported @media (prefers-color-scheme) blocks are removed earlier
// by the CSS filter.
import valueParser from 'postcss-value-parser';
import type { AtRule } from 'postcss';
import type { DarkModeStrategy, SourceLocation } from '../types';
import type { StageContext } from './context';
import { cssNodeLoc, type ParsedDeclaration, type RemoveToken, type StyleSheet } from '../parse/css';
import {
  walkElements,
  elementLoc,
  attrLoc,
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
import { contrastRatio, flipLightness, parseColor, rgbToHsl } from '../color';
import { supportFor } from '../data/snapshot';

const PREFERS_DARK_SLUG = 'css-at-media-prefers-color-scheme';
const META_SLUG = 'html-meta-color-scheme';
const PREFERS_DARK_DOC =
  'https://www.caniemail.com/features/css-at-media-prefers-color-scheme/';
const META_DOC = 'https://www.caniemail.com/features/html-meta-color-scheme/';
const DARK_MODE_DOC =
  'https://www.litmus.com/blog/the-ultimate-guide-to-dark-mode-for-email-marketers';
const CONTRAST_DOC = 'https://www.w3.org/WAI/WCAG21/Understanding/contrast-minimum.html';

const AA_NORMAL = 4.5;

// Undeclared text and background: the browser's light defaults, and what the
// preview shows once the dark scheme is declared (`color-scheme: dark`).
const LIGHT_TEXT = '#000000';
const LIGHT_BG = '#ffffff';
const DARK_TEXT = '#ffffff';
const DARK_BG = '#121212';

type Role = 'text' | 'background';

/** Which role a color property plays; undefined for anything else. */
function roleOf(prop: string): Role | undefined {
  if (prop === 'color') return 'text';
  if (prop === 'background-color' || /^border(-(top|right|bottom|left))?-color$/.test(prop)) return 'background';
  return undefined;
}

/**
 * The client's recoloring of one declared color, or null when it leaves the
 * color alone (or can't read it).
 */
export function recolor(strategy: DarkModeStrategy, value: string, role: Role): string | null {
  const v = value.trim().toLowerCase();
  if (v === 'transparent' || v === 'currentcolor' || v === 'inherit') return null;
  const c = parseColor(v);
  if (!c || c.a === 0) return null;
  if (strategy === 'full-invert') return flipLightness(v);
  if (strategy !== 'partial-invert') return null;
  const { l } = rgbToHsl(c);
  if (role === 'background' ? l > 0.5 : l < 0.5) return flipLightness(v);
  return null;
}

/**
 * True if the element directly or transitively contains non-whitespace text,
 * not counting subtrees for which `skip` returns true.
 * Iterative (explicit stack) — deeply nested markup can otherwise blow the
 * call stack, same reasoning as `walkElements` in parse/html.ts.
 */
function hasTextContent(node: Node, skip: (child: Node) => boolean = () => false): boolean {
  const stack: Node[] = [node];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const children = (current as { childNodes?: Node[] }).childNodes;
    if (!children) continue;
    for (const child of children) {
      if (isTextNode(child) && child.value.trim().length > 0) return true;
      if (!skip(child)) stack.push(child);
    }
  }
  return false;
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
  at: AtRule;
}

/**
 * Settle the author's prefers-color-scheme blocks for the simulated scheme
 * instead of leaving them in the output, where the preview browser would
 * evaluate them against the viewer's own OS setting. Blocks for the other
 * scheme are dropped; blocks for this scheme are returned for the caller to
 * apply. Not logged: this is the simulated condition, not something the
 * client did. (Blocks the client doesn't support are already gone: CSS filter.)
 */
function resolveSchemeMedia(ctx: StageContext, scheme: 'light' | 'dark'): DarkMedia[] {
  const own: DarkMedia[] = [];
  for (const sheet of ctx.sheets) {
    if (sheet.source.kind !== 'block') continue;
    const found: DarkMedia[] = [];
    sheet.root.walkAtRules('media', (at) => {
      if (/prefers-color-scheme\s*:\s*(light|dark)/i.test(at.params)) found.push({ sheet, at });
    });
    for (const m of found) {
      const forScheme = /prefers-color-scheme\s*:\s*dark/i.test(m.at.params) ? 'dark' : 'light';
      if (forScheme === scheme) {
        own.push(m);
      } else {
        m.at.remove();
        sheet.dirty = true;
      }
    }
  }
  return own;
}

/** Make a block's rules unconditional. */
function hoist({ sheet, at }: DarkMedia): void {
  at.replaceWith(...(at.nodes ?? []));
  sheet.dirty = true;
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
    hoist({ sheet, at });
  }
}

interface Pair {
  loc?: SourceLocation;
  colorBefore?: string;
  colorAfter?: string;
  bgBefore?: string;
  bgAfter?: string;
}

// Color attributes inverting clients recolor along with CSS.
const COLOR_ATTRS: { attr: string; role: Role; tags?: string[] }[] = [
  { attr: 'bgcolor', role: 'background' },
  { attr: 'color', role: 'text', tags: ['font'] },
  { attr: 'text', role: 'text', tags: ['body'] },
];

/**
 * Recolor every declared color the way the client does, CSS and HTML
 * attributes alike, except the author's own dark rules. Returns whether
 * anything changed.
 */
function invertColors(ctx: StageContext, strategy: DarkModeStrategy, authorDark: DarkMedia[]): boolean {
  const pairs = new Map<Element, Pair>();
  const own = new Set<AtRule>(authorDark.map((m) => m.at));
  const inAuthorDark = (d: ParsedDeclaration) => {
    for (let p = d.decl.parent; p; p = p.parent as typeof p) {
      if (own.has(p as AtRule)) return true;
    }
    return false;
  };
  const how = strategy === 'full-invert'
    ? 'flips the lightness of every color'
    : 'darkens light backgrounds and lightens dark text';
  let changed = 0;

  const track = (el: Element, role: Role, before: string, after: string, loc?: SourceLocation) => {
    const p = pairs.get(el) ?? { loc };
    if (role === 'text') {
      p.colorBefore = before;
      p.colorAfter = after;
    } else {
      p.bgBefore = before;
      p.bgAfter = after;
    }
    pairs.set(el, p);
  };

  for (const sheet of ctx.sheets) {
    for (const d of sheet.declarations) {
      const role = roleOf(d.prop);
      if (!role || inAuthorDark(d)) continue;
      const after = recolor(strategy, d.value, role);
      // Inline text/background pairs feed the contrast check, changed or not.
      if (d.origin === 'inline' && (d.prop === 'color' || d.prop === 'background-color')) {
        const parsed = parseColor(d.value);
        if (parsed && parsed.a > 0) track(d.element, role, d.value, after ?? d.value, d.loc);
      }
      if (!after) continue;
      if (d.expandedFrom && !d.removeToken) continue; // no token to rewrite
      if (d.expandedFrom) rewriteToken(d.removeToken!, after);
      else d.decl.value = after;
      sheet.dirty = true;
      changed++;
      ctx.mutations.push({
        client: ctx.clientId,
        stage: 'dark-mode',
        action: 'auto-invert-color',
        target: { loc: d.loc, element: d.element.tagName, property: d.prop, value: d.value },
        feature: 'darkmode-auto-invert',
        severity: 'warning',
        reason:
          `${ctx.profile.name} ${how} in dark mode: \`${d.prop}: ${d.value}\` was rendered ` +
          `as \`${after}\` (hue kept).`,
        evidence: DARK_MODE_DOC,
        fix: supportFor(PREFERS_DARK_SLUG, ctx.clientId).status !== 'n'
          ? 'Add an @media (prefers-color-scheme: dark) block to set these colors explicitly.'
          : `${ctx.profile.name} ignores @media (prefers-color-scheme: dark), so pick colors ` +
            'that stay readable when the client recolors them.',
      });
    }
  }

  walkElements(ctx.parsed.document, (el) => {
    for (const { attr, role, tags } of COLOR_ATTRS) {
      if (tags && !tags.includes(el.tagName)) continue;
      const a = getAttr(el, attr);
      if (!a) continue;
      const after = recolor(strategy, a.value, role);
      if (parseColor(a.value)) track(el, role, a.value, after ?? a.value, attrLoc(el, attr));
      if (!after) continue;
      ctx.mutations.push({
        client: ctx.clientId,
        stage: 'dark-mode',
        action: 'auto-invert-color',
        target: { loc: attrLoc(el, attr) ?? elementLoc(el), element: el.tagName, property: attr, value: a.value },
        feature: 'darkmode-auto-invert',
        severity: 'warning',
        reason:
          `${ctx.profile.name} ${how} in dark mode: \`${attr}="${a.value}"\` was rendered as ` +
          `\`${after}\` (hue kept).`,
        evidence: DARK_MODE_DOC,
      });
      a.value = after;
      changed++;
    }
  });

  ctx.recolor = (value, role) => recolor(strategy, value, role) ?? value;
  if (changed === 0) return false;
  flagContrastRegressions(ctx, pairs, hiddenElements(ctx));
  flagImageInversion(ctx);
  return true;
}

/** The nearest declared color of a kind, on the element or an ancestor. */
function inherited(el: Element, pairs: Map<Element, Pair>, kind: 'colorBefore' | 'bgBefore'): Pair | undefined {
  for (let n: Node | null = el; n; n = (n as { parentNode?: Node | null }).parentNode ?? null) {
    const p = pairs.get(n as Element);
    if (p?.[kind]) return p;
  }
  return undefined;
}

/** Elements hidden inline (`display:none`, e.g. a preheader) or by `hidden`. */
function hiddenElements(ctx: StageContext): Set<Node> {
  const hidden = new Set<Node>();
  for (const sheet of ctx.sheets) {
    for (const d of sheet.declarations) {
      if (d.origin === 'inline' && d.prop === 'display' && d.value.trim().toLowerCase() === 'none') {
        hidden.add(d.element);
      }
    }
  }
  walkElements(ctx.parsed.document, (el) => {
    if (getAttr(el, 'hidden')) hidden.add(el);
  });
  return hidden;
}

function flagContrastRegressions(
  ctx: StageContext,
  pairs: Map<Element, Pair>,
  hidden: Set<Node>,
): void {
  for (const [el, p] of pairs) {
    // No visible text → no readability concern. Text in a descendant that
    // declares its own color is that descendant's pair.
    if (hidden.has(el)) continue;
    const skip = (n: Node) =>
      hidden.has(n) || (n !== el && pairs.get(n as Element)?.colorBefore !== undefined);
    if (!hasTextContent(el, skip)) continue;

    // Text color and background are the nearest declared ones; undeclared,
    // they are the browser defaults, which follow the dark scheme.
    const text = inherited(el, pairs, 'colorBefore');
    const bg = inherited(el, pairs, 'bgBefore');
    const textBefore = parseColor(text?.colorBefore ?? LIGHT_TEXT);
    const textAfter = parseColor(text?.colorAfter ?? DARK_TEXT);
    const bgBefore = parseColor(bg?.bgBefore ?? LIGHT_BG);
    const bgAfter = parseColor(bg?.bgAfter ?? DARK_BG);
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
          value: `${text?.colorAfter ?? DARK_TEXT} on ${bg?.bgAfter ?? DARK_BG}`,
        },
        feature: 'darkmode-contrast',
        severity: 'error',
        reason:
          `After ${ctx.profile.name}'s dark-mode recoloring, the text on <${el.tagName}> is ` +
          `\`${text?.colorAfter ?? DARK_TEXT}\` on \`${bg?.bgAfter ?? DARK_BG}\`: ` +
          `${after.toFixed(2)}:1 (was ${before.toFixed(2)}:1), below the WCAG AA minimum of 4.5:1.`,
        evidence: CONTRAST_DOC,
        fix: 'Pick a text and background pair that stays above 4.5:1 once recolored, or set both explicitly for dark mode.',
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
    severity: 'warning',
    reason:
      `${ctx.profile.name} recolors backgrounds in dark mode but not images. ${imgs.length} ` +
      `image${imgs.length === 1 ? '' : 's'} may be affected: a transparent PNG logo sitting on a ` +
      `background that turns dark can become invisible or gain a jarring halo.`,
    evidence: DARK_MODE_DOC,
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
    evidence: DARK_MODE_DOC,
  });
}

// --- entry point ------------------------------------------------------------

export function runDarkMode(ctx: StageContext): void {
  const dm = ctx.profile.darkMode;

  if (ctx.render.colorScheme === 'light') {
    resolveSchemeMedia(ctx, 'light').forEach(hoist);
    hintColorScheme(ctx, 'light');
    return;
  }

  if (dm.strategy === 'none') {
    resolveSchemeMedia(ctx, 'light').forEach(hoist);
    hintColorScheme(ctx, 'light');
    ctx.mutations.push({
      client: ctx.clientId,
      stage: 'dark-mode',
      action: 'warn-only',
      target: {},
      feature: 'darkmode-no-change',
      severity: 'info',
      reason:
        `${ctx.profile.name} leaves the email's colors alone in dark mode: it shows the light ` +
        `design. ${dm.note}`,
      evidence: DARK_MODE_DOC,
    });
    return;
  }

  // Every other strategy renders under a dark OS setting, so the client's own
  // default background goes dark regardless of what the author declared.
  hintColorScheme(ctx, 'dark');

  // Blocks the client does not support were already removed by the CSS filter.
  const media = resolveSchemeMedia(ctx, 'dark');

  if (dm.strategy === 'native') {
    if (media.length) {
      applyPrefersDark(
        ctx,
        media,
        `${ctx.profile.name} honors @media (prefers-color-scheme: dark); the author's dark ` +
          `declaration was applied.`,
      );
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
          `@media (prefers-color-scheme: dark) styles: colors you set stay as they are, and ` +
          `undeclared backgrounds and text turn dark and light.`,
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
          `${ctx.profile.name} does not recolor email in dark mode. With no ` +
          `@media (prefers-color-scheme: dark) styles, colors you set stay as they are; ` +
          `undeclared backgrounds and text turn dark and light.`,
        evidence: PREFERS_DARK_DOC,
      });
    }
    return;
  }

  // partial-invert / full-invert
  invertColors(ctx, dm.strategy, media);
  if (dm.supportsOgscHack && hasOgsc(ctx)) applyOgsc(ctx);
  if (media.length) {
    applyPrefersDark(
      ctx,
      media,
      `${ctx.profile.name} honors @media (prefers-color-scheme: dark); the author's dark ` +
        `declaration was applied on top of its own recoloring.`,
    );
  }
}

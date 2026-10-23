// Outlook on Windows reads conditional comments; every other client, and the
// preview browser, sees them as plain comments. So for that client:
//
//   <!--[if mso]> … <![endif]-->            content is rendered (ghost tables,
//                                           VML buttons and backgrounds)
//   <!--[if !mso]><!--> … <!--<![endif]-->  content is hidden
//
// Revealing happens on the source string, before parsing, because a ghost
// table opens in one comment and closes in another. The markers are replaced
// with spaces of the same length, so every source location stays the same.
// Hiding happens on the AST. VML shapes, which a browser can't draw, are
// approximated with styled HTML at the end of the pipeline (renderVml), after
// the CSS filter, which must not judge the approximation as author CSS.
import type { ClientProfile, SourceLocation } from '../types';
import type { StageContext } from './context';
import {
  attrLoc,
  getAttr,
  isElement,
  walkElements,
  type ChildNode,
  type Element,
  type ParentNode,
} from '../parse/html';

const CONDITIONAL_DOC =
  'https://learn.microsoft.com/en-us/previous-versions/windows/internet-explorer/ie-developer/compatibility/ms537512(v=vs.85)';
const VML_DOC = 'https://learn.microsoft.com/en-us/windows/win32/vml/web-workshop---how-to-use-vml-on-web-pages';
const MSO_HIDE_DOC = 'https://www.caniemail.com/features/css-display-none/';

/** The Word engine version Outlook 2016 and later (including 365) report. */
const MSO_VERSION = 16;

/**
 * Evaluate a conditional comment expression for Outlook: `mso`, `!mso`,
 * `gte mso 9`, `(mso)|(IE)`, `!mso & !IE`. IE is never true; anything that
 * doesn't parse is false (the content stays hidden, as in a browser).
 */
export function evalCondition(expr: string): boolean {
  const tokens = expr.match(/\(|\)|!|&|\||[A-Za-z]+|\d+(?:\.\d+)?/g) ?? [];
  let i = 0;
  const peek = () => tokens[i];
  const next = () => tokens[i++];

  function term(): boolean {
    const t = next();
    if (t === '!') return !term();
    if (t === '(') {
      const v = or();
      if (next() !== ')') throw new Error('unbalanced');
      return v;
    }
    const op = t?.toLowerCase();
    if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
      const feature = next()?.toLowerCase();
      const version = Number(next());
      if (feature !== 'mso' || Number.isNaN(version)) return false;
      if (op === 'gt') return MSO_VERSION > version;
      if (op === 'gte') return MSO_VERSION >= version;
      if (op === 'lt') return MSO_VERSION < version;
      return MSO_VERSION <= version;
    }
    if (op === 'mso') {
      // `mso 16`: an exact version.
      if (peek() && /^\d/.test(peek()!)) return Math.floor(Number(next())) === MSO_VERSION;
      return true;
    }
    if (op === 'ie') {
      if (peek() && /^\d/.test(peek()!)) next();
      return false;
    }
    throw new Error(`unknown token ${t}`);
  }
  function and(): boolean {
    let v = term();
    while (peek() === '&') {
      next();
      v = term() && v;
    }
    return v;
  }
  function or(): boolean {
    let v = and();
    while (peek() === '|') {
      next();
      v = and() || v;
    }
    return v;
  }
  try {
    const v = or();
    return i === tokens.length ? v : false;
  } catch {
    return false;
  }
}

export interface RevealedBlock {
  expr: string;
  start: number;
  end: number;
}

// `<!--[if mso]>…<![endif]-->`, but not the downlevel-revealed opener
// `<!--[if !mso]><!-->`, whose content is outside the comment.
const HIDDEN_BLOCK = /<!--\[if ([^\]]+)\]>(?!\s*<!-*>)([\s\S]*?)<!\[endif\]-->/g;

/** Reveal the conditional blocks Outlook renders, keeping every offset. */
export function revealConditionals(html: string): { html: string; blocks: RevealedBlock[] } {
  const blocks: RevealedBlock[] = [];
  const out = html.replace(HIDDEN_BLOCK, (whole, expr: string, inner: string, offset: number) => {
    // Office settings (`<xml><o:OfficeDocumentSettings>`) are not content.
    if (!evalCondition(expr) || /^\s*<xml[\s>]/i.test(inner)) return whole;
    blocks.push({ expr: expr.trim(), start: offset, end: offset + whole.length });
    const open = whole.length - inner.length - '<![endif]-->'.length;
    return ' '.repeat(open) + inner + ' '.repeat('<![endif]-->'.length);
  });
  return { html: out, blocks };
}

export function readsConditionals(profile: ClientProfile): boolean {
  return profile.quirks.conditionalComments === true;
}

/** Log the revealed blocks and hide `<!--[if !mso]><!-->` content. */
export function runConditionals(ctx: StageContext, blocks: RevealedBlock[]): void {
  for (const block of blocks) {
    const s = ctx.parsed.lineIndex.toLineCol(block.start);
    const e = ctx.parsed.lineIndex.toLineCol(block.end);
    const loc: SourceLocation = { startLine: s.line, startCol: s.col, endLine: e.line, endCol: e.col };
    ctx.mutations.push({
      client: ctx.clientId,
      stage: 'sanitize',
      action: 'rewrite',
      target: { loc, element: `[if ${block.expr}]` },
      feature: 'quirk-outlook-conditional-shown',
      severity: 'info',
      reason:
        `${ctx.profile.name} reads conditional comments: the content of \`<!--[if ${block.expr}]>\` ` +
        `is rendered here, and only here.`,
      evidence: CONDITIONAL_DOC,
    });
  }

  // Downlevel-revealed: `<!--[if !mso]><!-->` and `<!--<![endif]-->` are two
  // comments with the content between them as siblings.
  const parents: ParentNode[] = [ctx.parsed.document];
  walkElements(ctx.parsed.document, (el) => {
    parents.push(el);
  });
  for (const parent of parents) {
    const children = parent.childNodes;
    for (let i = 0; i < children.length; i++) {
      const open = commentData(children[i]);
      const m = open && /^\[if ([^\]]+)\]><!(?:--\s*)?$/.exec(open.trim());
      if (!m || evalCondition(m[1])) continue;
      const close = children.findIndex((c, j) => j > i && /^<!\[endif\]$/.test(commentData(c)?.trim() ?? ''));
      if (close < 0) continue;
      const hidden = children.splice(i + 1, close - i - 1);
      const at = (children[i] as { sourceCodeLocation?: SourceLocation | null }).sourceCodeLocation;
      const loc = at && { startLine: at.startLine, startCol: at.startCol, endLine: at.endLine, endCol: at.endCol };
      if (hidden.some((n) => isElement(n) || (n as { value?: string }).value?.trim())) {
        ctx.mutations.push({
          client: ctx.clientId,
          stage: 'sanitize',
          action: 'remove-element',
          target: { loc: loc ?? undefined, element: `[if ${m[1].trim()}]` },
          feature: 'quirk-outlook-conditional-hidden',
          severity: 'info',
          reason:
            `${ctx.profile.name} reads conditional comments: the content after ` +
            `\`<!--[if ${m[1].trim()}]><!-->\` is hidden here, and shown everywhere else.`,
          evidence: CONDITIONAL_DOC,
        });
      }
    }
  }
}

function commentData(node: ChildNode | undefined): string | undefined {
  return node && node.nodeName === '#comment' ? (node as { data: string }).data : undefined;
}

// --- VML ---------------------------------------------------------------------

function styleOf(el: Element): Map<string, string> {
  const map = new Map<string, string>();
  for (const part of (getAttr(el, 'style')?.value ?? '').split(';')) {
    const at = part.indexOf(':');
    if (at > 0) map.set(part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim());
  }
  return map;
}

const px = (v: string | undefined) => {
  const m = v && /^(-?\d+(?:\.\d+)?)(px|pt)?$/i.exec(v.trim());
  if (!m) return undefined;
  return m[2]?.toLowerCase() === 'pt' ? (Number(m[1]) * 4) / 3 : Number(m[1]);
};

/** VML booleans: `f`, `false`, `t`, `true`. */
const vmlFalse = (v: string | undefined) => v !== undefined && /^(f|false)$/i.test(v.trim());

/** Move an element's children up to its place, dropping the element. */
function unwrapInPlace(el: Element): void {
  const parent = el.parentNode as ParentNode | null;
  if (!parent) return;
  const idx = parent.childNodes.indexOf(el as ChildNode);
  for (const child of el.childNodes) (child as ChildNode).parentNode = parent;
  parent.childNodes.splice(idx, 1, ...el.childNodes);
}

/** `inset="10px,5px,10px,5px"` (left, top, right, bottom) as CSS padding. */
function insetPadding(inset: string | undefined): string | undefined {
  if (!inset) return undefined;
  const [l = '0', t = '0', r = '0', b = '0'] = inset.split(',').map((v) => {
    const n = px(v || '0');
    return n === undefined ? '0' : `${n}px`;
  });
  return `${t} ${r} ${b} ${l}`;
}

/**
 * Draw VML shapes (`v:rect`, `v:roundrect`, `v:oval`) as styled HTML, so a
 * bulletproof button or background image looks in the preview as it does in
 * Outlook. Fill, stroke, size, corner radius, image fill and text box inset
 * are carried over; other VML is not.
 */
export function renderVml(ctx: StageContext): void {
  const shapes: Element[] = [];
  const wrappers: Element[] = [];
  walkElements(ctx.parsed.document, (el) => {
    if (/^v:(rect|roundrect|oval)$/.test(el.tagName)) shapes.push(el);
    // Written self-closing, but HTML parsing makes them wrap what follows.
    else if (/^(v:fill|v:stroke|v:shadow|v:imagedata|w:anchorlock|o:[\w-]+)$/.test(el.tagName)) wrappers.push(el);
  });
  if (shapes.length === 0) {
    wrappers.forEach(unwrapInPlace);
    return;
  }

  for (const shape of shapes) {
    const style = styleOf(shape);
    const width = px(style.get('width'));
    const height = px(style.get('height'));
    const fill = shape.childNodes.find((c): c is Element => isElement(c) && c.tagName === 'v:fill');
    const stroked = !vmlFalse(getAttr(shape, 'stroked')?.value) && !vmlFalse(getAttr(shape, 'stroke')?.value);
    const fillColor = getAttr(fill ?? shape, 'color')?.value ?? getAttr(shape, 'fillcolor')?.value;
    const filled = !vmlFalse(getAttr(shape, 'filled')?.value);
    const image = fill && getAttr(fill, 'src')?.value;

    // v-text-anchor:middle centers the content vertically.
    const middle = /middle/.test(style.get('v-text-anchor') ?? '');
    const css: string[] = middle
      ? ['display:inline-flex', 'flex-direction:column', 'justify-content:center']
      : ['display:inline-block'];
    css.push('box-sizing:border-box', 'vertical-align:top');
    if (width !== undefined) css.push(`width:${width}px`);
    if (height !== undefined) css.push(`min-height:${height}px`);
    if (filled && fillColor) css.push(`background-color:${fillColor}`);
    if (image) css.push(`background-image:url("${image.replace(/"/g, '%22')}")`, 'background-size:cover');
    if (stroked) {
      const weight = px(getAttr(shape, 'strokeweight')?.value) ?? 1;
      css.push(`border:${weight}px solid ${getAttr(shape, 'strokecolor')?.value ?? '#000'}`);
    }
    if (shape.tagName === 'v:oval') css.push('border-radius:50%');
    if (shape.tagName === 'v:roundrect') {
      // arcsize: the corner radius as a fraction of the shorter side.
      const arc = getAttr(shape, 'arcsize')?.value ?? '20%';
      const fraction = arc.endsWith('%') ? parseFloat(arc) / 100 : parseFloat(arc) / 65536;
      const side = Math.min(width ?? Infinity, height ?? Infinity);
      if (Number.isFinite(side) && Number.isFinite(fraction)) css.push(`border-radius:${Math.round(side * fraction)}px`);
    }

    for (const box of shape.childNodes) {
      if (!isElement(box) || box.tagName !== 'v:textbox') continue;
      // VML's default inset is 0.1in by 0.05in.
      const boxCss = [`padding:${insetPadding(getAttr(box, 'inset')?.value) ?? '5px 10px'}`];
      box.tagName = 'div';
      box.nodeName = 'div';
      box.attrs = [{ name: 'style', value: boxCss.join(';') }];
    }

    shape.tagName = 'div';
    shape.nodeName = 'div';
    shape.attrs = [{ name: 'style', value: css.join(';') }];
  }
  wrappers.forEach(unwrapInPlace);

  ctx.mutations.push({
    client: ctx.clientId,
    stage: 'quirk',
    action: 'rewrite',
    target: { element: 'v:*' },
    feature: 'quirk-outlook-vml',
    severity: 'info',
    reason:
      `${ctx.profile.name} draws VML shapes. A browser can't, so the preview approximates ` +
      `${shapes.length} shape${shapes.length === 1 ? '' : 's'} with HTML: fill, border, size, ` +
      `corner radius and image fill are shown; gradients and other VML effects are not.`,
    evidence: VML_DOC,
  });
}

/** `mso-hide:all` hides an element in Outlook only. */
export function applyMsoHide(ctx: StageContext): void {
  walkElements(ctx.parsed.document, (el) => {
    const attr = getAttr(el, 'style');
    if (!attr || !/mso-hide\s*:\s*all/i.test(attr.value)) return;
    if (/(^|;)\s*display\s*:\s*none/i.test(attr.value)) return; // hidden already
    attr.value = `${attr.value.replace(/;?\s*$/, '')};display:none`;
    ctx.mutations.push({
      client: ctx.clientId,
      stage: 'quirk',
      action: 'rewrite',
      target: { element: el.tagName, loc: attrLoc(el, 'style'), property: 'mso-hide', value: 'all' },
      feature: 'quirk-outlook-mso-hide',
      severity: 'info',
      reason: `${ctx.profile.name} hides elements styled \`mso-hide:all\`; this one is hidden here.`,
      evidence: MSO_HIDE_DOC,
    });
  });
}

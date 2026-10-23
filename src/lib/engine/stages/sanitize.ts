// Sanitize stage: removes or unwraps HTML elements the target client does not
// support (per the caniemail `html` category), plus a universal security list
// (script/iframe/embed) that is stripped for every client.
//
//   - default action for an unsupported element:   unwrap-element (keep children)
//   - REMOVE_WHEN_UNSUPPORTED / SECURITY_ALWAYS:    remove-element (drop subtree)
//   - unsupported attribute:                        remove-attribute
//   - partial support (a):                          warn-only (kept)
import type { Mutation } from '../types';
import { featureBySlug } from '../data/snapshot';
import {
  walkElements,
  elementLoc,
  attrLoc,
  getAttr,
  type Attribute,
  type DocumentType,
  type Element,
  type ParentNode,
  type ChildNode,
} from '../parse/html';
import type { StageContext } from './context';

/** tag name -> caniemail html slug (used for support lookup + evidence). */
const ELEMENT_SLUG: Record<string, string> = {
  abbr: 'html-abbr',
  acronym: 'html-acronym',
  address: 'html-address',
  area: 'html-image-maps',
  audio: 'html-audio',
  base: 'html-base',
  bdi: 'html-bdi',
  blockquote: 'html-blockquote',
  body: 'html-body',
  code: 'html-code',
  del: 'html-del',
  dfn: 'html-dfn',
  dialog: 'html-dialog',
  div: 'html-div',
  dl: 'html-lists',
  form: 'html-form',
  h1: 'html-h1-h6', h2: 'html-h1-h6', h3: 'html-h1-h6',
  h4: 'html-h1-h6', h5: 'html-h1-h6', h6: 'html-h1-h6',
  hr: 'html-hr',
  img: 'html-img',
  link: 'html-link',
  map: 'html-image-maps',
  marquee: 'html-marquee',
  meter: 'html-meter',
  object: 'html-object',
  ol: 'html-lists',
  p: 'html-p',
  picture: 'html-picture',
  pre: 'html-pre',
  progress: 'html-progress',
  rp: 'html-rp',
  rt: 'html-rt',
  ruby: 'html-ruby',
  select: 'html-select',
  small: 'html-small',
  span: 'html-span',
  strike: 'html-strike',
  strong: 'html-strong',
  style: 'html-style',
  svg: 'html-svg',
  table: 'html-table',
  textarea: 'html-textarea',
  ul: 'html-lists',
  video: 'html-video',
  wbr: 'html-wbr',
};

// HTML5 sectioning and semantic elements: one caniemail entry for all of them.
for (const tag of [
  'article', 'aside', 'details', 'figcaption', 'figure', 'footer', 'header',
  'main', 'nav', 'section', 'summary', 'time',
]) {
  ELEMENT_SLUG[tag] = 'html-semantics';
}

/** <input> has one caniemail entry per type; other types fall back to text. */
const INPUT_TYPE_SLUG: Record<string, string> = {
  checkbox: 'html-input-checkbox',
  hidden: 'html-input-hidden',
  radio: 'html-input-radio',
  reset: 'html-input-reset',
  submit: 'html-input-submit',
};

function slugFor(el: Element): string | undefined {
  const type = getAttr(el, 'type')?.value.trim().toLowerCase() ?? '';
  if (el.tagName === 'input') return INPUT_TYPE_SLUG[type] ?? 'html-input-text';
  // A <button> submits unless its type says otherwise.
  if (el.tagName === 'button') return type === 'reset' ? 'html-button-reset' : 'html-button-submit';
  return ELEMENT_SLUG[el.tagName];
}

/**
 * Always removed entirely, for every client — active content caniemail has no
 * entry for. <link>, <base> and <object> do have entries and follow the data.
 */
const SECURITY_ALWAYS = new Set(['script', 'iframe', 'embed']);

/** When caniemail marks these unsupported, remove the whole subtree (not unwrap). */
const REMOVE_WHEN_UNSUPPORTED = new Set([
  'form', 'input', 'select', 'textarea', 'button', 'video', 'audio', 'svg', 'dialog',
  'link', 'base', 'object', 'style', 'map', 'area',
]);

/** Attributes with their own caniemail entry. */
const ATTRIBUTE_SLUG: Record<string, string> = {
  align: 'html-align',
  'aria-describedby': 'html-aria-describedby',
  'aria-hidden': 'html-aria-hidden',
  'aria-label': 'html-aria-label',
  'aria-labelledby': 'html-aria-labelledby',
  'aria-live': 'html-aria-live',
  background: 'html-background',
  cellpadding: 'html-cellpadding',
  cellspacing: 'html-cellspacing',
  command: 'html-command-attribute',
  commandfor: 'html-command-attribute',
  dir: 'html-dir',
  height: 'html-height',
  hidden: 'html-hidden',
  inert: 'css-inert-attribute', // caniemail files it under CSS
  lang: 'html-lang',
  loading: 'html-loading-attribute',
  popover: 'html-popover',
  popovertarget: 'html-popover',
  popovertargetaction: 'html-popover',
  required: 'html-required',
  role: 'html-role',
  sizes: 'html-srcset',
  srcset: 'html-srcset',
  target: 'html-target',
  valign: 'html-valign',
  width: 'html-width',
};

function attributeSlug(el: Element, attr: Attribute): string | undefined {
  if (attr.name === 'href') {
    if (el.tagName !== 'a') return undefined;
    const href = attr.value.trim().toLowerCase();
    if (href.startsWith('#')) return 'html-anchor-links';
    if (href.startsWith('mailto:')) return 'html-mailto-links';
    return undefined;
  }
  return ATTRIBUTE_SLUG[attr.name];
}

/** Structural elements the engine must never touch. */
const NEVER_TOUCH = new Set(['html', 'head']);

function mdnEvidence(tag: string): string {
  return `https://developer.mozilla.org/en-US/docs/Web/HTML/Element/${tag}`;
}

function evidenceFor(tag: string, slug: string | undefined): string {
  if (slug) {
    const feature = featureBySlug.get(slug);
    if (feature) return feature.url;
  }
  return mdnEvidence(tag);
}

function detach(el: Element): void {
  const parent = el.parentNode as ParentNode | null;
  if (!parent) return;
  const idx = parent.childNodes.indexOf(el as ChildNode);
  if (idx >= 0) parent.childNodes.splice(idx, 1);
}

function unwrap(el: Element): void {
  const parent = el.parentNode as ParentNode | null;
  if (!parent) return;
  const idx = parent.childNodes.indexOf(el as ChildNode);
  if (idx < 0) return;
  const children = el.childNodes;
  for (const child of children) {
    (child as ChildNode).parentNode = parent;
  }
  parent.childNodes.splice(idx, 1, ...children);
}

function isConnected(el: Element, document: ParentNode): boolean {
  let node: ParentNode | null = el.parentNode as ParentNode | null;
  while (node) {
    if (node === document) return true;
    node = (node as { parentNode?: ParentNode | null }).parentNode ?? null;
  }
  return false;
}

interface Op {
  el: Element;
  apply: 'remove' | 'unwrap';
}

export function runSanitize(ctx: StageContext): void {
  const { clientId, parsed } = ctx;
  const ops: Op[] = [];
  checkDoctype(ctx);

  walkElements(parsed.document, (el) => {
    const tag = el.tagName;
    if (NEVER_TOUCH.has(tag)) return;

    // 1. Universal security removal.
    if (SECURITY_ALWAYS.has(tag)) {
      ops.push({ el, apply: 'remove' });
      ctx.mutations.push(securityMutation(ctx, el, tag));
      return;
    }

    // 2. caniemail-driven element support.
    const slug = slugFor(el);
    if (!slug) return;
    const feature = featureBySlug.get(slug);
    if (!feature) return;
    const support = feature.support[clientId];

    if (support.status === 'n') {
      const remove = REMOVE_WHEN_UNSUPPORTED.has(tag);
      ops.push({ el, apply: remove ? 'remove' : 'unwrap' });
      ctx.mutations.push({
        client: clientId,
        stage: 'sanitize',
        action: remove ? 'remove-element' : 'unwrap-element',
        target: { element: tag, loc: elementLoc(el) },
        feature: slug,
        severity: 'error',
        reason:
          `${ctx.profile.name} does not support the <${tag}> element ` +
          `(${feature.title}). It was ${remove ? 'removed entirely' : 'unwrapped (tag dropped, contents kept)'}.` +
          appendNotes(support.notes),
        evidence: feature.url,
      });
    } else if (support.status === 'a') {
      ctx.mutations.push({
        client: clientId,
        stage: 'sanitize',
        action: 'warn-only',
        target: { element: tag, loc: elementLoc(el) },
        feature: slug,
        severity: 'warning',
        reason:
          `${ctx.profile.name} has partial support for the <${tag}> element ` +
          `(${feature.title}). It was kept, but may render inconsistently.` +
          appendNotes(support.notes),
        evidence: feature.url,
      });
    }
  });

  // Apply mutations to the AST, deepest-first, skipping detached nodes.
  for (let i = ops.length - 1; i >= 0; i--) {
    const { el, apply } = ops[i];
    if (!isConnected(el, parsed.document)) continue;
    if (apply === 'remove') detach(el);
    else unwrap(el);
  }

  // Attributes, on the elements that are left.
  walkElements(parsed.document, (el) => {
    for (const attr of [...el.attrs]) {
      const slug = attributeSlug(el, attr);
      const feature = slug ? featureBySlug.get(slug) : undefined;
      if (!slug || !feature) continue;
      const support = feature.support[clientId];
      if (support.status !== 'n' && support.status !== 'a') continue;
      const removed = support.status === 'n';
      if (removed) el.attrs.splice(el.attrs.indexOf(attr), 1);
      ctx.mutations.push({
        client: clientId,
        stage: 'sanitize',
        action: removed ? 'remove-attribute' : 'warn-only',
        target: {
          element: el.tagName,
          loc: attrLoc(el, attr.name) ?? elementLoc(el),
          property: attr.name,
          value: attr.value,
        },
        feature: slug,
        severity: removed ? 'error' : 'warning',
        reason:
          (removed
            ? `${ctx.profile.name} does not support ${feature.title}. \`${attr.name}\` was ` +
              `removed from <${el.tagName}>.`
            : `${ctx.profile.name} has partial support for ${feature.title}. \`${attr.name}\` ` +
              `on <${el.tagName}> was kept.`) + appendNotes(support.notes),
        evidence: feature.url,
      });
    }
  });
}

/**
 * caniemail's one document-level entry: the HTML5 doctype (`<!DOCTYPE html>`,
 * no public id). It is only reported, never removed: without a doctype the
 * preview browser would switch to quirks mode, which no email client does.
 */
function checkDoctype(ctx: StageContext): void {
  const doctype = ctx.parsed.document.childNodes.find(
    (n): n is DocumentType => n.nodeName === '#documentType',
  );
  if (!doctype || doctype.name.toLowerCase() !== 'html' || doctype.publicId) return;
  const feature = featureBySlug.get('html-doctype');
  if (!feature) return;
  const support = feature.support[ctx.clientId];
  if (support.status !== 'n' && support.status !== 'a') return;
  ctx.mutations.push({
    client: ctx.clientId,
    stage: 'sanitize',
    action: 'warn-only',
    target: { element: '!doctype', loc: elementLoc(doctype) },
    feature: 'html-doctype',
    severity: 'warning',
    reason:
      (support.status === 'n'
        ? `${ctx.profile.name} does not support the HTML5 doctype; it has no effect on ` +
          `how the email renders.`
        : `${ctx.profile.name} has partial support for the HTML5 doctype.`) +
      appendNotes(support.notes),
    evidence: feature.url,
  });
}

function securityMutation(ctx: StageContext, el: Element, tag: string): Mutation {
  const slug = ELEMENT_SLUG[tag];
  return {
    client: ctx.clientId,
    stage: 'sanitize',
    action: 'remove-element',
    target: { element: tag, loc: elementLoc(el) },
    feature: slug ?? `sanitize-security-${tag}`,
    severity: 'error',
    reason:
      `<${tag}> is stripped by email clients as active/unsafe content and was ` +
      `removed entirely. This applies to every client, not just ${ctx.profile.name}.`,
    evidence: evidenceFor(tag, slug),
  };
}

function appendNotes(notes: string[]): string {
  return notes.length ? ` Notes: ${notes.join(' ')}` : '';
}

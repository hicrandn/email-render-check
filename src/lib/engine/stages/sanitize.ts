// Sanitize stage: removes or unwraps HTML elements and attributes the target
// client does not support (per the caniemail `html` and `image` categories),
// plus a universal security list (script/iframe/embed) stripped for every client.
//
//   - default action for an unsupported element:   unwrap-element (keep children)
//   - REMOVE_WHEN_UNSUPPORTED / SECURITY_ALWAYS:    remove-element (drop subtree)
//   - unsupported attribute or <img> format:        remove-attribute
//   - partial support (a):                          per the notes (partial.ts),
//     e.g. Gmail's <style> limits; otherwise warn-only (kept)
import type { ClientSupport, Mutation } from '../types';
import { featureBySlug } from '../data/snapshot';
import {
  walkElements,
  elementLoc,
  attrLoc,
  getAttr,
  isTextNode,
  type Attribute,
  type DocumentType,
  type Element,
  type ParentNode,
  type ChildNode,
} from '../parse/html';
import type { StageContext } from './context';
import { judgeDeclaration, styleElementLimits, unsupportedTag } from './partial';

/** tag name -> caniemail html slug (used for support lookup + evidence). */
export const ELEMENT_SLUG: Record<string, string> = {
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
export const INPUT_TYPE_SLUG: Record<string, string> = {
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
export const ATTRIBUTE_SLUG: Record<string, string> = {
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

/** Image formats caniemail tracks, by file extension and by data: URI MIME type. */
export const IMAGE_EXTENSION_SLUG: Record<string, string> = {
  apng: 'image-apng',
  avif: 'image-avif',
  bmp: 'image-bmp',
  gif: 'image-gif',
  hdr: 'image-hdr',
  heic: 'image-heif',
  heif: 'image-heif',
  ico: 'image-ico',
  jpeg: 'image-jpg',
  jpg: 'image-jpg',
  mp4: 'image-mp4',
  png: 'image-png',
  svg: 'image-svg',
  tif: 'image-tiff',
  tiff: 'image-tiff',
  webp: 'image-webp',
};
export const IMAGE_MIME_SLUG: Record<string, string> = {
  'image/apng': 'image-apng',
  'image/avif': 'image-avif',
  'image/bmp': 'image-bmp',
  'image/gif': 'image-gif',
  'image/heic': 'image-heif',
  'image/heif': 'image-heif',
  'image/jpeg': 'image-jpg',
  'image/png': 'image-png',
  'image/svg+xml': 'image-svg',
  'image/tiff': 'image-tiff',
  'image/vnd.microsoft.icon': 'image-ico',
  'image/webp': 'image-webp',
  'image/x-icon': 'image-ico',
  'video/mp4': 'image-mp4',
};

function imageSlugs(src: string): string[] {
  const value = src.trim().toLowerCase();
  if (value.startsWith('data:')) {
    const mime = IMAGE_MIME_SLUG[value.slice(5).split(/[;,]/)[0]];
    return mime ? ['image-base64', mime] : ['image-base64'];
  }
  const ext = /\.([a-z0-9]+)$/.exec(value.split(/[?#]/)[0])?.[1];
  const slug = ext ? IMAGE_EXTENSION_SLUG[ext] : undefined;
  return slug ? [slug] : [];
}

/** caniemail slugs an attribute relies on, most specific first. */
function attributeSlugs(el: Element, attr: Attribute): string[] {
  if (attr.name === 'href') {
    if (el.tagName !== 'a') return [];
    const href = attr.value.trim().toLowerCase();
    if (href.startsWith('#')) return ['html-anchor-links'];
    if (href.startsWith('mailto:')) return ['html-mailto-links'];
    return [];
  }
  if (attr.name === 'src' && el.tagName === 'img') return imageSlugs(attr.value);
  const slug = ATTRIBUTE_SLUG[attr.name];
  return slug ? [slug] : [];
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
    // Elements the parser implied (a missing <body>) are not the author's.
    if (!el.sourceCodeLocation) return;

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
          `${ctx.profile.name} does not support the <${tag}> element${titleSuffix(tag, feature.title)}. ` +
          `It was ${remove ? 'removed with its contents' : 'unwrapped: the tag is gone, its contents stay'}.` +
          appendNotes(support.notes),
        evidence: feature.url,
      });
    } else if (support.status === 'a') {
      const dropped = partialDrop(ctx, el, slug, support);
      if (dropped === 'ok') return;
      if (dropped) {
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
            `${ctx.profile.name} supports ${feature.title} only in part: ${dropped}. The <${tag}> ` +
            `element was ${remove ? 'removed with its contents' : 'unwrapped: the tag is gone, its contents stay'}.` +
            appendNotes(support.notes),
          evidence: feature.url,
        });
        return;
      }
      ctx.mutations.push({
        client: clientId,
        stage: 'sanitize',
        action: 'warn-only',
        target: { element: tag, loc: elementLoc(el) },
        feature: slug,
        severity: 'warning',
        reason:
          `${ctx.profile.name} has partial support for the <${tag}> element${titleSuffix(tag, feature.title)}. ` +
          `It was kept, but may render differently.` +
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
    for (const attr of [...el.attrs]) checkAttribute(ctx, el, attr);
  });
}

/**
 * For a partially supported element: why the client drops this one, 'ok' when
 * the notes say it is kept as is, or null when they can't be checked.
 */
function partialDrop(
  ctx: StageContext,
  el: Element,
  slug: string,
  support: ClientSupport,
): string | 'ok' | null {
  if (slug === 'html-semantics') {
    const dropped = unsupportedTag(support, el.tagName);
    if (dropped === null) return null;
    return dropped ? `<${el.tagName}> is not one of the elements it keeps` : 'ok';
  }
  if (slug === 'html-style') {
    const limits = styleElementLimits(support);
    if (!limits.inBody && insideBody(el)) return '<style> is not supported inside <body>';
    const text = el.childNodes.find(isTextNode)?.value ?? '';
    const kb = new TextEncoder().encode(text).length / 1024;
    if (limits.maxKB !== undefined && kb > limits.maxKB) {
      return `a <style> element is limited to ${limits.maxKB} KB and this one is ${kb.toFixed(1)} KB`;
    }
    return limits.other ? null : 'ok';
  }
  return null;
}

function insideBody(el: Element): boolean {
  for (let p = el.parentNode as Element | null; p && 'tagName' in p; p = p.parentNode as Element | null) {
    if (p.tagName === 'body') return true;
  }
  return false;
}

function checkAttribute(ctx: StageContext, el: Element, attr: Attribute): void {
  const warns: Mutation[] = [];
  for (const slug of attributeSlugs(el, attr)) {
    const feature = featureBySlug.get(slug);
    if (!feature) continue;
    const support = feature.support[ctx.clientId];
    if (support.status !== 'n' && support.status !== 'a') continue;
    // Partial: the notes may say which elements or values it works with.
    const judged = support.status === 'a'
      ? judgeDeclaration(support, { prop: attr.name, value: attr.value, element: el.tagName })
      : null;
    if (judged?.kind === 'ok') continue;
    const removed = support.status === 'n' || judged?.kind === 'remove';
    // An image the client cannot show: dropping src shows what the reader gets.
    const consequence = attr.name === 'src' ? ', so the image does not display' : '';
    const mutation: Mutation = {
      client: ctx.clientId,
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
          ? `${ctx.profile.name} ${judged?.kind === 'remove' ? `supports ${feature.title} only in part: ${judged.why}` : `does not support ${feature.title}`}. ` +
            `\`${attr.name}\` was removed from <${el.tagName}>${consequence}.`
          : `${ctx.profile.name} has partial support for ${feature.title}. \`${attr.name}\` ` +
            `on <${el.tagName}> was kept.`) + appendNotes(support.notes),
      evidence: feature.url,
    };
    if (removed) {
      el.attrs.splice(el.attrs.indexOf(attr), 1);
      ctx.mutations.push(mutation);
      return; // first unsupported slug wins; the attribute is gone
    }
    warns.push(mutation);
  }
  ctx.mutations.push(...warns);
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

/** The caniemail title, unless it only repeats the tag (`<style> element`). */
function titleSuffix(tag: string, title: string): string {
  return title.toLowerCase().includes(`<${tag}`) ? '' : ` (${title})`;
}

function appendNotes(notes: string[]): string {
  return notes.length ? ` Notes: ${notes.join(' ')}` : '';
}

// Sanitize stage: removes or unwraps HTML elements the target client does not
// support (per the caniemail `html` category), plus a universal security list
// (script/iframe/…) that is stripped for every client.
//
//   - default action for an unsupported element:   unwrap-element (keep children)
//   - REMOVE_WHEN_UNSUPPORTED / SECURITY_ALWAYS:    remove-element (drop subtree)
//   - partial support (a):                          warn-only (element kept)
import type { Mutation } from '../types';
import { featureBySlug } from '../data/snapshot';
import {
  walkElements,
  elementLoc,
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
  audio: 'html-audio',
  bdi: 'html-bdi',
  blockquote: 'html-blockquote',
  button: 'html-button-submit',
  code: 'html-code',
  del: 'html-del',
  dfn: 'html-dfn',
  dialog: 'html-dialog',
  div: 'html-div',
  form: 'html-form',
  h1: 'html-h1-h6', h2: 'html-h1-h6', h3: 'html-h1-h6',
  h4: 'html-h1-h6', h5: 'html-h1-h6', h6: 'html-h1-h6',
  hr: 'html-hr',
  img: 'html-img',
  input: 'html-input-text',
  marquee: 'html-marquee',
  meter: 'html-meter',
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
  svg: 'html-svg',
  table: 'html-table',
  textarea: 'html-textarea',
  video: 'html-video',
  wbr: 'html-wbr',
};

/** Always removed entirely, for every client — security / active content. */
const SECURITY_ALWAYS = new Set([
  'script', 'iframe', 'object', 'embed', 'base', 'link',
]);

/** When caniemail marks these unsupported, remove the whole subtree (not unwrap). */
const REMOVE_WHEN_UNSUPPORTED = new Set([
  'form', 'input', 'select', 'textarea', 'button', 'video', 'audio', 'svg', 'dialog',
]);

/** Structural elements the engine must never touch. */
const NEVER_TOUCH = new Set(['html', 'head', 'body', 'style']);

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
    const slug = ELEMENT_SLUG[tag];
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

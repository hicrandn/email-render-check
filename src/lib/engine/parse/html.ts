// HTML parsing via parse5, with full source-location info retained.
// No DOM / window usage — operates purely on strings and the parse5 AST.
import { parse, parseFragment, serialize, defaultTreeAdapter } from 'parse5';
import type { DefaultTreeAdapterMap } from 'parse5';
import type { SourceLocation } from '../types';
import { LineIndex } from './position';

export type Node = DefaultTreeAdapterMap['node'];
export type Element = DefaultTreeAdapterMap['element'];
export type TextNode = DefaultTreeAdapterMap['textNode'];
export type ChildNode = DefaultTreeAdapterMap['childNode'];
export type ParentNode = DefaultTreeAdapterMap['parentNode'];
export type Attribute = Element['attrs'][number];

export interface ParsedHtml {
  document: DefaultTreeAdapterMap['document'];
  lineIndex: LineIndex;
  source: string;
}

export function parseHtml(html: string): ParsedHtml {
  const document = parse(html, { sourceCodeLocationInfo: true });
  return { document, lineIndex: new LineIndex(html), source: html };
}

export function serializeHtml(parsed: ParsedHtml): string {
  return serialize(parsed.document);
}

export function isElement(node: Node): node is Element {
  return defaultTreeAdapter.isElementNode(node);
}
export function isTextNode(node: Node): node is TextNode {
  return defaultTreeAdapter.isTextNode(node);
}

/**
 * Depth-first walk over all element nodes, visited in document order.
 * Iterative (explicit stack) rather than recursive — real emails can nest
 * deeply enough (thousands of levels) to blow the call stack otherwise.
 */
export function walkElements(
  root: ParentNode,
  visit: (el: Element, parent: ParentNode) => void,
): void {
  const stack: { node: ChildNode; parent: ParentNode }[] = [];
  const rootChildren = root.childNodes ?? [];
  for (let i = rootChildren.length - 1; i >= 0; i--) {
    stack.push({ node: rootChildren[i], parent: root });
  }
  while (stack.length > 0) {
    const { node, parent } = stack.pop()!;
    if (!isElement(node)) continue;
    visit(node, parent);
    const children = node.childNodes ?? [];
    for (let i = children.length - 1; i >= 0; i--) {
      stack.push({ node: children[i], parent: node });
    }
  }
}

export function getAttr(el: Element, name: string): Attribute | undefined {
  return el.attrs.find((a) => a.name === name);
}

/** First matching element in document order, or undefined. */
export function findElement(root: ParentNode, tagName: string): Element | undefined {
  let found: Element | undefined;
  walkElements(root, (el) => {
    if (!found && el.tagName === tagName) found = el;
  });
  return found;
}

/** Build a `<style>` element node (with a text child) from raw CSS. */
export function buildStyleNode(css: string, attrs: Attribute[] = []): Element {
  const frag = parseFragment(`<style>${css}</style>`);
  const style = frag.childNodes[0] as Element;
  style.attrs.push(...attrs);
  return style;
}

/** Insert a node as the first child of a parent, wiring up parentNode. */
export function prependChild(parent: ParentNode, node: ChildNode): void {
  (node as ChildNode).parentNode = parent;
  parent.childNodes.unshift(node);
}

/** Convert a parse5 location to our SourceLocation shape. */
function toSourceLocation(loc: {
  startLine: number;
  startCol: number;
  endLine: number;
  endCol: number;
}): SourceLocation {
  return {
    startLine: loc.startLine,
    startCol: loc.startCol,
    endLine: loc.endLine,
    endCol: loc.endCol,
  };
}

export function elementLoc(el: Element): SourceLocation | undefined {
  const loc = el.sourceCodeLocation;
  if (!loc) return undefined;
  return toSourceLocation(loc);
}

// ---------------------------------------------------------------------------
// Style-source collection: both <style> blocks and style="" attributes.
// Each source records the absolute offset where its CSS text begins, so css.ts
// can translate postcss-relative positions into absolute HTML positions.
// ---------------------------------------------------------------------------

export interface InlineStyleSource {
  kind: 'inline';
  element: Element;
  attr: Attribute;
  css: string;
  baseOffset: number;
}
export interface BlockStyleSource {
  kind: 'block';
  element: Element;
  textNode: TextNode;
  css: string;
  baseOffset: number;
}
export type StyleSource = InlineStyleSource | BlockStyleSource;

export function collectStyleSources(parsed: ParsedHtml): StyleSource[] {
  const sources: StyleSource[] = [];
  const { source } = parsed;

  walkElements(parsed.document, (el) => {
    // <style> blocks
    if (el.tagName === 'style') {
      const textNode = el.childNodes.find(isTextNode);
      const textLoc = textNode?.sourceCodeLocation;
      if (textNode && textLoc) {
        sources.push({
          kind: 'block',
          element: el,
          textNode,
          css: textNode.value,
          baseOffset: textLoc.startOffset,
        });
      }
    }

    // style="" attributes
    const styleAttr = getAttr(el, 'style');
    const styleLoc = el.sourceCodeLocation?.attrs?.style;
    if (styleAttr && styleLoc && styleAttr.value.length > 0) {
      // Locate where the value begins inside `style = "..."`.
      const attrText = source.slice(styleLoc.startOffset, styleLoc.endOffset);
      const m = /^style\s*=\s*(['"]?)/i.exec(attrText);
      const valueStartInAttr = m ? m[0].length : attrText.indexOf('=') + 1;
      sources.push({
        kind: 'inline',
        element: el,
        attr: styleAttr,
        css: styleAttr.value,
        baseOffset: styleLoc.startOffset + valueStartInAttr,
      });
    }
  });

  return sources;
}

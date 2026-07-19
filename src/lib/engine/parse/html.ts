// HTML parsing via parse5, with full source-location info retained.
// No DOM / window usage — operates purely on strings and the parse5 AST.
import { parse, serialize, defaultTreeAdapter } from 'parse5';
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

/** Depth-first walk over all element nodes. Visited in document order. */
export function walkElements(
  root: ParentNode,
  visit: (el: Element, parent: ParentNode) => void,
): void {
  const children = root.childNodes ?? [];
  for (const child of children) {
    if (isElement(child)) {
      visit(child, root);
      walkElements(child, visit);
    } else if ('childNodes' in child && child.childNodes) {
      walkElements(child as ParentNode, visit);
    }
  }
}

export function getAttr(el: Element, name: string): Attribute | undefined {
  return el.attrs.find((a) => a.name === name);
}

/** Convert a parse5 location to our SourceLocation shape. */
export function toSourceLocation(loc: {
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

export function attrLoc(el: Element, name: string): SourceLocation | undefined {
  const loc = el.sourceCodeLocation?.attrs?.[name];
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

// CSS parsing for both <style> blocks and style="" attributes.
// - postcss-safe-parser tolerates the malformed CSS real emails ship with.
// - Every declaration gets an absolute SourceLocation in the original HTML.
// - Shorthands (border/background/font/margin/padding) are expanded so that,
//   e.g., `background-image` can be derived from `background: url(x) no-repeat`.
//
// Each ParsedDeclaration keeps a reference to its postcss node so later stages
// can remove or rewrite it; the engine then stringifies the root back into the
// owning AST node. No regex-based detection, no DOM.
import safeParse from 'postcss-safe-parser';
import valueParser from 'postcss-value-parser';
import type { Declaration, Node as CssNode, Root } from 'postcss';
import type { SourceLocation } from '../types';
import type { Element, StyleSource } from './html';
import { LineIndex } from './position';

export interface RemoveToken {
  /** The shorthand declaration whose value contains the token. */
  parentDecl: Declaration;
  /** Index of the token within the shorthand's value string. */
  sourceIndex: number;
  /** The token text, used to locate and drop it during rewrite. */
  text: string;
}

export interface ParsedDeclaration {
  prop: string; // normalized lowercase property name
  value: string;
  important: boolean;
  loc: SourceLocation;
  origin: 'inline' | 'block';
  element: Element;
  selector?: string; // rule selector, for block sources
  /** postcss node to remove for property-level / whole-declaration removal. */
  decl: Declaration;
  sheet: StyleSheet;
  /** Present when this declaration was synthesized from a shorthand. */
  expandedFrom?: string;
  /** For value-level removal inside a shorthand: which token to drop. */
  removeToken?: RemoveToken;
}

export interface StyleSheet {
  source: StyleSource;
  root: Root;
  declarations: ParsedDeclaration[];
  /** Set by stages when the root is mutated; triggers write-back in the engine. */
  dirty: boolean;
  /** The client dropped the whole <style> element or style attribute. */
  stripped?: boolean;
}

const EXPANDABLE = new Set(['border', 'background', 'font', 'margin', 'padding']);

function locFromOffsets(
  lineIndex: LineIndex,
  startOffset: number,
  endOffset: number,
): SourceLocation {
  const s = lineIndex.toLineCol(startOffset);
  const e = lineIndex.toLineCol(endOffset);
  return { startLine: s.line, startCol: s.col, endLine: e.line, endCol: e.col };
}

/** Absolute offset (in the HTML) at which a declaration's VALUE begins. */
function valueBaseOffset(baseOffset: number, decl: Declaration): number {
  const between = decl.raws.between ?? ':';
  return baseOffset + (decl.source?.start?.offset ?? 0) + decl.prop.length + between.length;
}

interface Expansion {
  prop: string;
  value: string;
  token?: { sourceIndex: number; text: string };
}

const COLOR_KEYWORDS = new Set([
  'transparent', 'currentcolor', 'black', 'white', 'red', 'green', 'blue',
  'gray', 'grey', 'silver', 'maroon', 'yellow', 'olive', 'lime', 'aqua',
  'teal', 'navy', 'fuchsia', 'purple', 'orange',
]);
const COLOR_FUNCS = new Set(['rgb', 'rgba', 'hsl', 'hsla', 'oklch', 'oklab', 'lab', 'lch', 'hwb', 'color']);
const BORDER_STYLES = new Set([
  'none', 'hidden', 'dotted', 'dashed', 'solid', 'double', 'groove',
  'ridge', 'inset', 'outset',
]);

function isColorNode(node: valueParser.Node): boolean {
  if (node.type === 'word') {
    const v = node.value.toLowerCase();
    return v.startsWith('#') || COLOR_KEYWORDS.has(v);
  }
  return node.type === 'function' && COLOR_FUNCS.has(node.value.toLowerCase());
}

/** Expand a supported shorthand into the longhands we can derive from it. */
function expandShorthand(prop: string, value: string): Expansion[] {
  const parsed = valueParser(value);
  const nodes = parsed.nodes.filter((n) => n.type !== 'space' && n.type !== 'div');
  const out: Expansion[] = [];

  const nodeText = (n: valueParser.Node) => valueParser.stringify(n);

  if (prop === 'background') {
    for (const n of nodes) {
      if (n.type === 'function' && /^(?:repeating-)?(?:linear|radial|conic)-gradient$/i.test(n.value)) {
        out.push({ prop: 'background-image', value: nodeText(n), token: { sourceIndex: n.sourceIndex, text: nodeText(n) } });
      } else if (n.type === 'function' && n.value.toLowerCase() === 'url') {
        out.push({ prop: 'background-image', value: nodeText(n), token: { sourceIndex: n.sourceIndex, text: nodeText(n) } });
      } else if (isColorNode(n)) {
        out.push({ prop: 'background-color', value: nodeText(n), token: { sourceIndex: n.sourceIndex, text: nodeText(n) } });
      }
    }
  } else if (prop === 'border') {
    for (const n of nodes) {
      if (n.type === 'word' && BORDER_STYLES.has(n.value.toLowerCase())) {
        out.push({ prop: 'border-style', value: n.value });
      } else if (isColorNode(n)) {
        out.push({ prop: 'border-color', value: nodeText(n) });
      } else if (n.type === 'word' && /^[\d.]+[a-z%]*$/i.test(n.value)) {
        out.push({ prop: 'border-width', value: n.value });
      }
    }
  } else if (prop === 'font') {
    // font: [style] [weight] size[/line-height] family
    // Best-effort: line-height appears as `size/line-height`.
    const slash = value.indexOf('/');
    if (slash >= 0) {
      const lh = value.slice(slash + 1).trim().split(/\s+/)[0];
      if (lh) out.push({ prop: 'line-height', value: lh });
    }
  } else if (prop === 'margin' || prop === 'padding') {
    const sides = nodes.map(nodeText);
    const [top, right = top, bottom = top, left = right] = sides;
    if (top !== undefined) {
      out.push({ prop: `${prop}-top`, value: top });
      out.push({ prop: `${prop}-right`, value: right });
      out.push({ prop: `${prop}-bottom`, value: bottom });
      out.push({ prop: `${prop}-left`, value: left });
    }
  }

  return out;
}

export function parseStyleSheet(
  source: StyleSource,
  lineIndex: LineIndex,
): StyleSheet {
  const root: Root = safeParse(source.css);
  const sheet: StyleSheet = { source, root, declarations: [], dirty: false };

  root.walkDecls((decl: Declaration) => {
    const startOffset = source.baseOffset + (decl.source?.start?.offset ?? 0);
    const endRel = decl.source?.end?.offset ?? (decl.source?.start?.offset ?? 0);
    const endOffset = source.baseOffset + endRel + 1;
    const loc = locFromOffsets(lineIndex, startOffset, endOffset);
    const prop = decl.prop.toLowerCase();
    const selector =
      decl.parent && decl.parent.type === 'rule'
        ? (decl.parent as { selector?: string }).selector
        : undefined;

    const base: ParsedDeclaration = {
      prop,
      value: decl.value,
      important: decl.important ?? false,
      loc,
      origin: source.kind,
      element: source.element,
      selector,
      decl,
      sheet,
    };
    sheet.declarations.push(base);

    // Shorthand expansion -> virtual longhand declarations.
    if (EXPANDABLE.has(prop)) {
      const valueBase = valueBaseOffset(source.baseOffset, decl);
      for (const ex of expandShorthand(prop, decl.value)) {
        const exLoc = ex.token
          ? locFromOffsets(
              lineIndex,
              valueBase + ex.token.sourceIndex,
              valueBase + ex.token.sourceIndex + ex.token.text.length,
            )
          : loc;
        sheet.declarations.push({
          prop: ex.prop,
          value: ex.value,
          important: base.important,
          loc: exLoc,
          origin: source.kind,
          element: source.element,
          selector,
          decl,
          sheet,
          expandedFrom: prop,
          removeToken: ex.token
            ? { parentDecl: decl, sourceIndex: ex.token.sourceIndex, text: ex.token.text }
            : undefined,
        });
      }
    }
  });

  return sheet;
}

/** Absolute location in the HTML of any node (rule, at-rule, declaration) in a sheet. */
export function cssNodeLoc(
  sheet: StyleSheet,
  lineIndex: LineIndex,
  node: CssNode,
): SourceLocation | undefined {
  const start = node.source?.start?.offset;
  if (start === undefined) return undefined;
  const end = node.source?.end?.offset;
  const base = sheet.source.baseOffset;
  return locFromOffsets(lineIndex, base + start, base + (end === undefined ? start : end + 1));
}

/** False once the node, or any ancestor, has been removed from the sheet. */
export function isAttached(sheet: StyleSheet, node: CssNode): boolean {
  let current: CssNode | Root = node;
  while (current.parent) current = current.parent as CssNode | Root;
  return current === sheet.root;
}

/**
 * Remove a single token from a shorthand declaration's value (used when only a
 * derived longhand — e.g. background-image — is unsupported). Drops the token
 * and any now-redundant adjacent whitespace. Returns true if the token was found.
 */
export function removeTokenFromDecl(token: RemoveToken): boolean {
  const parsed = valueParser(token.parentDecl.value);
  let removed = false;
  const kept: valueParser.Node[] = [];
  for (const node of parsed.nodes) {
    if (!removed && node.sourceIndex === token.sourceIndex) {
      removed = true;
      continue;
    }
    kept.push(node);
  }
  if (!removed) return false;
  // Trim leading/trailing space nodes left behind.
  while (kept.length && kept[0].type === 'space') kept.shift();
  while (kept.length && kept[kept.length - 1].type === 'space') kept.pop();
  parsed.nodes = kept;
  token.parentDecl.value = valueParser.stringify(parsed.nodes).trim();
  return true;
}

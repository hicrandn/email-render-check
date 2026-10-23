// Partial support, made concrete. Can I Email marks many entries "a" and says
// in a note what the client actually does: "Only supported on table cells",
// "Negative values are not supported", "Replaces `height` by `min-height`".
// This module reads those notes and judges a single declaration against them,
// so the preview drops what the client drops instead of keeping everything
// with a generic warning.
//
// Rules are keyed on the note text, not on client ids: when Can I Email
// rewrites a note, its rule stops applying and the entry falls back to a plain
// warning. Notes no rule understands (bugs, platform caveats) keep that
// warning too.
import valueParser from 'postcss-value-parser';
import type { ClientSupport } from '../types';

export interface DeclSubject {
  prop: string;
  value: string;
  /** The element, when the declaration is inline; unknown for <style> rules. */
  element?: string;
}

export type Judgement =
  /** Within what the client supports: nothing to report. */
  | { kind: 'ok' }
  /** Kept; the notes describe something this module cannot check. */
  | { kind: 'warn' }
  | { kind: 'remove'; why: string }
  | { kind: 'rewrite'; prop: string; value: string; why: string }
  /** The client drops the element's whole style attribute (Gmail). */
  | { kind: 'strip-attribute'; why: string }
  /** The client drops the whole <style> element (Gmail). */
  | { kind: 'strip-block'; why: string };

/** One note's verdict; null when the note is not about this kind of thing. */
type NoteVerdict = Judgement | null;

const UNITS = new Set(['rem', 'em', 'ch', 'ex', 'px', 'pt', 'vh', 'vw', 'vmin', 'vmax', '%']);

const tagsIn = (text: string) => [...text.matchAll(/`<(\w+)>`/g)].map((m) => m[1].toLowerCase());
const codesIn = (text: string) => [...text.matchAll(/`([^`]+)`/g)].map((m) => m[1]);

interface Tokens {
  words: string[];
  numbers: { value: number; unit: string }[];
  functions: valueParser.FunctionNode[];
}

function tokens(value: string): Tokens {
  const out: Tokens = { words: [], numbers: [], functions: [] };
  valueParser(value).walk((node) => {
    if (node.type === 'function') out.functions.push(node);
    if (node.type !== 'word') return;
    out.words.push(node.value.toLowerCase());
    const dim = valueParser.unit(node.value);
    if (dim && dim.number !== '' && !Number.isNaN(Number(dim.number))) {
      out.numbers.push({ value: Number(dim.number), unit: dim.unit.toLowerCase() });
    }
  });
  return out;
}

/** `rgb(0 128 0)`: arguments separated by spaces, not commas. */
function spaceSyntax(fn: valueParser.FunctionNode): boolean {
  return !fn.nodes.some((n) => n.type === 'div' && n.value === ',') && fn.nodes.some((n) => n.type === 'space');
}

/** Element restrictions: "Not supported on `<div>`…", "Only works on `<table>`…". */
function elementNote(note: string, s: DeclSubject): NoteVerdict {
  let allowed: string[] | undefined;
  let denied: string[] | undefined;
  if (/Only supported on table cells/i.test(note)) allowed = ['td', 'th'];
  const only = /Only (?:works|supported) on (?:the )?(.+?) (?:elements?|tag)\b/i.exec(note);
  if (only) allowed = tagsIn(only[1]);
  const not = /Not supported on (.+?) elements?\b/i.exec(note);
  if (not) denied = tagsIn(not[1]);
  const direct = /when applied directly to an? (`<\w+>`)/i.exec(note);
  if (direct) denied = tagsIn(direct[1]);
  // "Buggy. Unreliable if used on a `<p>` or a `<div>`." Kept either way.
  const unreliable = /Unreliable if used on (.+)$/i.exec(note);
  if (unreliable && !allowed && !denied) {
    if (!s.element) return { kind: 'warn' };
    return tagsIn(unreliable[1]).includes(s.element) ? { kind: 'warn' } : { kind: 'ok' };
  }
  if (!allowed && !denied) return null;
  if (!s.element) return { kind: 'warn' };
  if (allowed && !allowed.includes(s.element)) {
    return { kind: 'remove', why: `it only works on ${allowed.map((t) => `<${t}>`).join(', ')}` };
  }
  if (denied?.includes(s.element)) return { kind: 'remove', why: `it does not work on <${s.element}>` };
  return { kind: 'ok' };
}

function valueNote(note: string, s: DeclSubject, t: Tokens): NoteVerdict {
  if (/Negative values are not supported/i.test(note)) {
    return t.numbers.some((n) => n.value < 0)
      ? { kind: 'remove', why: 'negative values are not supported' }
      : { kind: 'ok' };
  }

  // "Replaces `height` by `min-height`."
  const replaces = /Replaces `([\w-]+)` by `([\w-]+)`/i.exec(note);
  if (replaces) {
    return s.prop === replaces[1]
      ? { kind: 'rewrite', prop: replaces[2], value: s.value, why: `it turns \`${replaces[1]}\` into \`${replaces[2]}\`` }
      : { kind: 'ok' };
  }

  // "`text-justify` is stripped except when the value is `inter-character`"
  const except = /stripped except when the value is (.+)$/i.exec(note);
  if (except) {
    const allowed = codesIn(except[1]);
    return t.words.some((w) => allowed.includes(w))
      ? { kind: 'ok' }
      : { kind: 'remove', why: `only ${allowed.map((a) => `\`${a}\``).join(' or ')} is kept` };
  }

  // "Only supports `display:none` (but not on `<img>`)."
  const onlyValue = /Only supports `([\w-]+):([\w-]+)`/i.exec(note);
  if (onlyValue && s.prop === onlyValue[1]) {
    const value = s.value.trim().toLowerCase();
    if (value === onlyValue[2]) {
      return s.element && /but not on/i.test(note) && tagsIn(note).includes(s.element)
        ? { kind: 'remove', why: `\`${value}\` does not work on <${s.element}>` }
        : { kind: 'ok' };
    }
    // An image left inline would gain the baseline gap browsers give inline
    // images, which Word does not draw; keep the value rather than invent one.
    if (s.element === 'img') return { kind: 'warn' };
    return { kind: 'remove', why: `only \`${onlyValue[1]}:${onlyValue[2]}\` is supported` };
  }

  // "Supports `column-gap` for flexbox."
  const supportsProp = /^Partial\. Supports `?([\w-]+)`? for/i.exec(note);
  if (supportsProp) {
    return s.prop === supportsProp[1]
      ? { kind: 'ok' }
      : { kind: 'remove', why: `only \`${supportsProp[1]}\` is supported` };
  }

  if (/Longhand properties are not supported/i.test(note)) {
    return s.prop.includes('-') ? { kind: 'remove', why: 'longhand properties are not supported' } : { kind: 'ok' };
  }

  // Word: "`<number>` values between 0 and 599 are set as normal font weight…"
  if (/between 0 and 599 are set as normal/i.test(note)) {
    const n = Number(s.value.trim());
    if (!Number.isFinite(n) || s.value.trim() === '') return { kind: 'ok' };
    const value = n >= 600 ? 'bold' : 'normal';
    return { kind: 'rewrite', prop: s.prop, value, why: `numeric weights render as \`normal\` below 600 and \`bold\` from 600` };
  }
  // Yahoo: "Only the following numeric values are supported: 100, 200, …"
  const numeric = /Only the following numeric values are supported: ([\d, and]+)/i.exec(note);
  if (numeric) {
    const allowed: string[] = numeric[1].match(/\d+/g) ?? [];
    const n = s.value.trim();
    return /^\d+(\.\d+)?$/.test(n) && !allowed.includes(n)
      ? { kind: 'remove', why: `only ${allowed.join(', ')} are supported` }
      : { kind: 'ok' };
  }

  // Word: "A border can not be bigger than 8px."
  const max = /can not be bigger than (\d+)px/i.exec(note);
  if (max) {
    const limit = Number(max[1]);
    if (!t.numbers.some((n) => n.unit === 'px' && n.value > limit)) return { kind: 'ok' };
    const parsed = valueParser(s.value);
    parsed.walk((node) => {
      if (node.type !== 'word') return;
      const dim = valueParser.unit(node.value);
      if (dim && dim.unit.toLowerCase() === 'px' && Number(dim.number) > limit) node.value = `${limit}px`;
    });
    return { kind: 'rewrite', prop: s.prop, value: parsed.toString(), why: `borders are capped at ${limit}px` };
  }

  // Gmail: "The entire `list-style` property is removed if present."
  if (/entire `[\w-]+` property is removed/i.test(note)) {
    return t.functions.some((f) => f.value.toLowerCase() === 'url')
      ? { kind: 'remove', why: 'an image in `list-style` removes the whole property' }
      : { kind: 'ok' };
  }

  // "Does not support multiple values. The comma between two values is removed."
  if (/Does not support multiple values/i.test(note)) {
    const comma = valueParser(s.value).nodes.some((n) => n.type === 'div' && n.value === ',');
    return comma ? { kind: 'remove', why: 'several comma-separated values are not supported' } : { kind: 'ok' };
  }
  // Word: "Not supported with multiple values." (text-decoration)
  if (/Not supported with multiple values/i.test(note)) {
    return t.words.length > 1 ? { kind: 'remove', why: 'several values are not supported' } : { kind: 'ok' };
  }
  // "the `/ value` shorthand", "slash `/` notation is not supported"
  if (/`\/ value` shorthand|slash `\/` notation/i.test(note)) {
    const slash = valueParser(s.value).nodes.some((n) => n.type === 'div' && n.value === '/');
    return slash ? { kind: 'remove', why: 'the `/` syntax in this shorthand is not supported' } : { kind: 'ok' };
  }
  // Word: "Only `background-color` values are supported." Images go through
  // background-image; anything else in the shorthand is left to a warning.
  if (/Only `background-color` values are supported/i.test(note)) {
    return t.words.length === 1 && t.functions.length === 0 ? { kind: 'ok' } : { kind: 'warn' };
  }
  // Word: "`em` and `px` units behave weirdly." Unitless values are fine.
  const weird = /^(?:Buggy\.\s*)?((?:`\w+`(?: and |, )?)+) units behave/i.exec(note);
  if (weird) {
    const units = codesIn(weird[1]);
    return t.numbers.some((n) => units.includes(n.unit)) ? { kind: 'warn' } : { kind: 'ok' };
  }
  // "`overflow-block` & `overflow-inline` not supported": properties, not values.
  const props = /^(?:Partial\.\s*)?((?:`[\w-]+`(?:\s*(?:&|and|,)\s*)?)+) not supported/i.exec(note);
  if (props) {
    const names = codesIn(props[1]);
    return names.includes(s.prop) ? { kind: 'remove', why: `\`${s.prop}\` is not supported` } : { kind: 'ok' };
  }

  // Unsupported keywords and units, in their various phrasings:
  // "`auto` value is not supported", "Doesn't support the `match-parent` value",
  // "Flow-relative values `start` and `end` are not supported",
  // "`rem` values are not supported", "Does not support `rem` and `ch` values",
  // "Supports `sticky` but not `relative`, `absolute` and `fixed`".
  const butNot = /Supports .+? but not (.+?)\.?$/i.exec(note);
  const phrased =
    butNot?.[1] ??
    /^(?:Partial(?: support)?\.\s*)?(?:Does not support|Doesn't support)(.+?)(?:values?)?\.?$/i.exec(note)?.[1] ??
    /(.+?)(?:values? )?(?:are|is) not supported\.?$/i.exec(note)?.[1];
  if (phrased) {
    // Codes that are not a single keyword or unit (`inline flow`) are not checked.
    const codes = codesIn(phrased).map((c) => c.toLowerCase()).filter((c) => /^[\w-]+$|^%$/.test(c));
    if (codes.length === 0) return null;
    const units = codes.filter((c) => UNITS.has(c));
    const keywords = codes.filter((c) => !UNITS.has(c));
    const hit =
      keywords.find((k) => t.words.includes(k)) ??
      units.find((u) => t.numbers.some((n) => n.unit === u));
    if (!hit) return { kind: 'ok' };
    if (hit === 'auto' && /^margin/.test(s.prop)) {
      // Word drops `auto`: the element is not centered, the other sides stay.
      const value = valueParser(s.value);
      value.walk((node) => {
        if (node.type === 'word' && node.value.toLowerCase() === 'auto') node.value = '0';
      });
      return { kind: 'rewrite', prop: s.prop, value: value.toString(), why: '`auto` margins are not supported' };
    }
    return { kind: 'remove', why: `\`${hit}\` is not supported` };
  }
  return null;
}

/** Whitespace color syntax: Gmail drops the whole attribute or <style> block. */
function colorNote(note: string, s: DeclSubject, t: Tokens): NoteVerdict {
  const fns = t.functions.filter((f) => /^(rgba?|hsla?)$/i.test(f.value));
  if (/Whitespace syntax is not supported/i.test(note) || /whitespace syntax/i.test(note)) {
    if (!fns.some(spaceSyntax)) return { kind: 'ok' };
    if (/the whole attribute is stripped/i.test(note)) {
      return s.element
        ? { kind: 'strip-attribute', why: 'space-separated `rgb()` removes the whole style attribute' }
        : { kind: 'strip-block', why: 'space-separated `rgb()` removes the whole <style> element' };
    }
    return { kind: 'remove', why: 'space-separated `rgb()` is not supported' };
  }
  if (/Alpha value is not supported/i.test(note)) {
    const alpha = fns.some((f) => f.nodes.filter((n) => n.type === 'div' && n.value === ',').length >= 3);
    return alpha ? { kind: 'remove', why: 'a fourth (alpha) value is not supported' } : { kind: 'ok' };
  }
  if (/will remove all inline styles/i.test(note)) {
    return s.element
      ? { kind: 'strip-attribute', why: 'this color syntax removes every inline style on the element' }
      : null;
  }
  return null;
}

/**
 * Notes that do not concern what the preview shows: our own platform note,
 * old browsers, and the Gmail apps with a non-Google account (the Gmail
 * profiles simulate a Gmail account).
 */
function irrelevantNote(note: string): boolean {
  return (
    /^Differs by platform:/.test(note) ||
    /Internet Explorer|in IE\b|Firefox/.test(note) ||
    /non Google accounts?|Non Gmail Account/i.test(note)
  );
}

/**
 * Judge a declaration against a client's notes for one Can I Email entry.
 * For an "n" entry, returns what replaces the plain removal (a rewrite, or a
 * whole attribute or <style> element dropped), or null when nothing does.
 */
export function judgeDeclaration(support: ClientSupport, s: DeclSubject): Judgement | null {
  const t = tokens(s.value);
  const verdicts: Judgement[] = [];
  let unknown = support.notes.length === 0;
  for (const note of support.notes) {
    if (irrelevantNote(note)) continue;
    const v = colorNote(note, s, t) ?? elementNote(note, s) ?? valueNote(note, s, t);
    if (!v || v.kind === 'warn') unknown = true;
    else verdicts.push(v);
  }
  const worst = verdicts.sort((a, b) => SEVERITY[a.kind] - SEVERITY[b.kind])[0];
  if (support.status === 'n') {
    // Unsupported: removed anyway, unless a note says what replaces it.
    return worst && worst.kind !== 'remove' && worst.kind !== 'ok' ? worst : null;
  }
  if (worst && worst.kind !== 'ok') return worst;
  return unknown ? { kind: 'warn' } : { kind: 'ok' };
}

/**
 * `!important`, by its raw spelling: "Only supported in lowercase." Gmail then
 * drops the whole style attribute or <style> element (email-bugs#13).
 */
export function judgeImportant(support: ClientSupport, raw: string, inline: boolean): Judgement {
  let unknown = support.notes.length === 0;
  for (const note of support.notes) {
    if (irrelevantNote(note)) continue;
    if (/Only supported in lowercase/i.test(note)) {
      if (raw !== raw.toLowerCase()) {
        const why = `\`${raw}\` is not lowercase`;
        return inline ? { kind: 'strip-attribute', why } : { kind: 'strip-block', why };
      }
      continue;
    }
    unknown = true;
  }
  return unknown ? { kind: 'warn' } : { kind: 'ok' };
}

const SEVERITY: Record<Judgement['kind'], number> = {
  'strip-block': 0,
  'strip-attribute': 1,
  remove: 2,
  rewrite: 3,
  warn: 4,
  ok: 5,
};

// --- at-rules, selectors, elements ------------------------------------------

/**
 * Whether a client keeps an @media query, per its notes: "Does not support
 * height based media queries", "Only supports `screen`, `min-width` … based
 * media queries", "Nested media queries are removed".
 */
export function judgeMedia(support: ClientSupport, params: string, nested: boolean): Judgement {
  let known = support.notes.every(irrelevantNote) && support.notes.length > 0;
  const features: string[] = [];
  const words: string[] = [];
  valueParser(params).walk((node) => {
    if (node.type === 'function' && node.value === '') {
      const first = node.nodes.find((n) => n.type === 'word');
      if (first) features.push(first.value.toLowerCase());
      return false;
    }
    if (node.type === 'word') words.push(node.value.toLowerCase());
    return undefined;
  });
  for (const note of support.notes) {
    if (irrelevantNote(note)) continue;
    if (/nested media queries/i.test(note)) {
      known = true;
      if (nested) return { kind: 'remove', why: 'nested media queries are removed' };
      continue;
    }
    if (/height based media queries/i.test(note)) {
      known = true;
      const f = features.find((x) => /height/.test(x));
      if (f) return { kind: 'remove', why: `height-based queries (\`${f}\`) are not supported` };
      continue;
    }
    const only = /Only supports (.+?) based media queries/i.exec(note);
    if (only) {
      known = true;
      const allowed = codesIn(only[1]).map((c) => c.toLowerCase());
      const keywords = new Set(['and', 'only', ...allowed]);
      const bad = features.find((f) => !allowed.includes(f)) ?? words.find((w) => !keywords.has(w));
      if (bad) return { kind: 'remove', why: `only ${allowed.map((a) => `\`${a}\``).join(', ')} queries are supported, not \`${bad}\`` };
      continue;
    }
    return { kind: 'warn' };
  }
  return known ? { kind: 'ok' } : { kind: 'warn' };
}

export interface SelectorSubject {
  /** The compound the feature sits in has a type selector (`a:hover`). */
  hasType: boolean;
  /** For attribute selectors: the operator (`=`, `~=`) or '' for `[attr]`. */
  operator?: string;
  /** For attribute selectors: the attribute name. */
  attribute?: string;
  /** For attribute selectors: combined with a class in the same compound. */
  withClass?: boolean;
}

/** Selector restrictions: type selectors only, supported attribute syntaxes. */
export function judgeSelector(support: ClientSupport, s: SelectorSubject): Judgement {
  let known = support.notes.every(irrelevantNote) && support.notes.length > 0;
  for (const note of support.notes) {
    if (irrelevantNote(note)) continue;
    if (/Only supported on type selectors/i.test(note)) {
      known = true;
      if (!s.hasType) return { kind: 'remove', why: 'it only works after a type selector, like `a:hover`' };
      continue;
    }
    if (s.operator !== undefined) {
      const syntaxes = /Only supports (.+?) syntax/i.exec(note);
      if (syntaxes) {
        known = true;
        const ops = codesIn(syntaxes[1]).map((c) => /^\[\w+([~|^$*]?=)?/.exec(c)?.[1] ?? '');
        if (!ops.includes(s.operator)) {
          return { kind: 'remove', why: `only ${codesIn(syntaxes[1]).map((c) => `\`${c}\``).join(', ')} syntax is supported` };
        }
        const name = /Only `(\w+)` as an attribute name/i.exec(note);
        if (name && s.attribute !== name[1]) {
          return { kind: 'remove', why: `only \`${name[1]}\` works as the attribute name` };
        }
        continue;
      }
      if (/Can not be used with a class selector/i.test(note)) {
        known = true;
        if (s.withClass) return { kind: 'remove', why: 'it cannot be combined with a class selector' };
        continue;
      }
    }
    return { kind: 'warn' };
  }
  return known ? { kind: 'ok' } : { kind: 'warn' };
}

/**
 * Which of a family's elements a client drops, for entries like
 * html-semantics: "`<details>`, `<main>`, `<nav>` and `<summary>` are not
 * supported" or "Only `<time>` is supported". Null when the notes don't say.
 */
export function unsupportedTag(support: ClientSupport, tag: string): boolean | null {
  for (const note of support.notes) {
    const only = /Only (`<\w+>`(?:,? (?:and )?`<\w+>`)*) (?:is|are) supported/i.exec(note);
    if (only) return !tagsIn(only[1]).includes(tag);
    const not = /^(?:Partial\.\s*)?(`<\w+>`(?:,? (?:and )?`<\w+>`)*) are not supported/i.exec(note);
    if (not) return tagsIn(not[1]).includes(tag);
  }
  return null;
}

/**
 * Gmail's <style> limits: "Not supported inside the `<body>`", "limited to
 * 16 KB". `other` is set when a note says something else.
 */
export function styleElementLimits(support: ClientSupport): { inBody: boolean; maxKB?: number; other: boolean } {
  let inBody = true;
  let maxKB: number | undefined;
  let other = false;
  for (const note of support.notes) {
    if (irrelevantNote(note)) continue;
    const body = /Not supported inside the `<body>`/i.test(note);
    const kb = /limited to (\d+) ?KB/i.exec(note);
    if (body) inBody = false;
    if (kb) maxKB = Number(kb[1]);
    if (!body && !kb) other = true;
  }
  return { inBody, maxKB, other };
}

/** "The nested selectors are removed, making the nested properties apply to the parent selector." */
export function nestingFlattens(support: ClientSupport): boolean {
  return support.notes.some((n) => /nested properties apply to the parent/i.test(n));
}

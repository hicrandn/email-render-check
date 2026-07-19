// Quirks stage: per-client rendering behaviors that go beyond feature support.
//
//   - Outlook (Word): ignores @media entirely and ignores max-width on non-table
//     elements. Media queries are stripped so the preview matches Outlook.
//   - Gmail: clips messages larger than ~102 KB and shows a "[Message clipped]"
//     notice. Handled after serialization (it is a raw byte-level cut).
//   - Yahoo / Outlook.com / Gmail: partial/unreliable @media support -> warn.
import type { AtRule } from 'postcss';
import type { Mutation, SourceLocation } from '../types';
import type { StageContext } from './context';
import type { StyleSheet } from '../parse/css';

const GMAIL_CLIP_DOC =
  'https://github.com/hteumeuleu/email-bugs/issues/41'; // documents Gmail's 102KB clipping

function atRuleLoc(ctx: StageContext, sheet: StyleSheet, at: AtRule): SourceLocation | undefined {
  const start = at.source?.start;
  const end = at.source?.end;
  if (!start) return undefined;
  const base = sheet.source.baseOffset;
  const s = ctx.parsed.lineIndex.toLineCol(base + start.offset);
  const e = end
    ? ctx.parsed.lineIndex.toLineCol(base + end.offset + 1)
    : s;
  return { startLine: s.line, startCol: s.col, endLine: e.line, endCol: e.col };
}

/** AST / stylesheet quirks. Runs before serialization. */
export function runQuirks(ctx: StageContext): void {
  const q = ctx.profile.quirks;

  // --- @media handling -------------------------------------------------------
  if (q.ignoresMediaQueries || q.partialMediaQueries) {
    for (const sheet of ctx.sheets) {
      if (sheet.source.kind !== 'block') continue;
      const mediaRules: AtRule[] = [];
      sheet.root.walkAtRules('media', (at) => {
        mediaRules.push(at);
      });
      for (const at of mediaRules) {
        const loc = atRuleLoc(ctx, sheet, at);
        if (q.ignoresMediaQueries) {
          at.remove();
          sheet.dirty = true;
          ctx.mutations.push({
            client: ctx.clientId,
            stage: 'quirk',
            action: 'remove-element',
            target: { loc, selector: `@media ${at.params}` },
            feature: 'quirk-outlook-media',
            severity: 'error',
            reason:
              `${ctx.profile.name} uses the Word engine, which ignores @media rules ` +
              `entirely. The \`@media ${at.params}\` block was dropped — responsive ` +
              `styles never apply; design mobile-first with fluid, hybrid layouts instead.`,
            evidence: 'https://www.caniemail.com/features/css-at-media/',
          });
        } else {
          ctx.mutations.push({
            client: ctx.clientId,
            stage: 'quirk',
            action: 'warn-only',
            target: { loc, selector: `@media ${at.params}` },
            feature: 'quirk-media-partial',
            severity: 'warning',
            reason:
              `${ctx.profile.name} has partial/unreliable @media support. The ` +
              `\`@media ${at.params}\` block was kept, but may be stripped or ignored ` +
              `depending on the query.`,
            evidence: 'https://www.caniemail.com/features/css-at-media/',
          });
        }
      }
    }
  }

  // --- Outlook ignores max-width on non-table elements -----------------------
  if (q.ignoresMaxWidth) {
    for (const sheet of ctx.sheets) {
      for (const decl of sheet.declarations) {
        if (decl.prop !== 'max-width') continue;
        if (decl.element.tagName === 'table' || decl.element.tagName === 'td') continue;
        ctx.mutations.push({
          client: ctx.clientId,
          stage: 'quirk',
          action: 'warn-only',
          target: {
            loc: decl.loc,
            element: decl.element.tagName,
            property: 'max-width',
            value: decl.value,
          },
          feature: 'quirk-outlook-maxwidth',
          severity: 'warning',
          reason:
            `${ctx.profile.name} ignores \`max-width\` on <${decl.element.tagName}>. ` +
            `The Word engine renders at a fixed width and will let this element grow ` +
            `past ${decl.value}. Constrain layout with a fixed-width <table> instead.`,
          evidence: 'https://www.caniemail.com/features/css-max-width/',
        });
      }
    }
  }
}

/**
 * Output-level quirks that operate on the final serialized HTML.
 * Gmail clips the raw message at ~102 KB (often mid-element) and appends a
 * "[Message clipped]" notice — reproduced here byte-for-byte.
 */
export function applyOutputQuirks(ctx: StageContext, html: string): string {
  const maxKB = ctx.profile.quirks.maxSizeKB;
  if (!maxKB) return html;

  const limit = maxKB * 1024;
  const bytes = new TextEncoder().encode(html);
  if (bytes.length <= limit) return html;

  const truncated = new TextDecoder().decode(bytes.slice(0, limit));
  const banner =
    '<div style="padding:12px 16px;text-align:center;font-family:Arial,sans-serif;' +
    'font-size:13px;color:#5f6368;background:#f1f3f4;border-top:1px solid #dadce0;">' +
    '[Message clipped] &nbsp;View entire message</div>';

  const clip: Mutation = {
    client: ctx.clientId,
    stage: 'quirk',
    action: 'rewrite',
    target: { element: 'body' },
    feature: 'quirk-gmail-clipping',
    severity: 'warning',
    reason:
      `${ctx.profile.name} clips messages larger than ${maxKB} KB. This email is ` +
      `${(bytes.length / 1024).toFixed(1)} KB, so it was cut at ${maxKB} KB (often ` +
      `mid-element) and a "[Message clipped]" link is shown. Trim the HTML to stay ` +
      `under the limit.`,
    evidence: GMAIL_CLIP_DOC,
  };
  ctx.mutations.push(clip);

  return truncated + banner;
}

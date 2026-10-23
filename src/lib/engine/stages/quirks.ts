// Quirks stage: per-client rendering behaviors that go beyond feature support.
// (@media support is feature support and is handled by the CSS filter.)
//
//   - Outlook (Word): computes percentage widths differently. (Where Word
//     drops max-width, padding or margin, Can I Email's notes say so and the
//     CSS filter acts on them: partial.ts.)
//   - Gmail: clips messages larger than ~102 KB and shows a "[Message clipped]"
//     notice. Handled after serialization (it is a raw byte-level cut).
//   - Phones: fixed widths wider than the screen (mobile-fit.ts).
import type { Mutation } from '../types';
import type { StageContext } from './context';
import { checkMobileFit } from './mobile-fit';

const GMAIL_CLIP_DOC =
  'https://github.com/hteumeuleu/email-bugs/issues/41'; // documents Gmail's 102KB clipping

/** AST / stylesheet quirks. Runs before serialization. */
export function runQuirks(ctx: StageContext): void {
  const q = ctx.profile.quirks;

  // --- Outlook computes percentage table widths differently ------------------
  if (q.unreliablePercentWidth) {
    for (const sheet of ctx.sheets) {
      for (const decl of sheet.declarations) {
        if (decl.prop !== 'width' || !decl.value.trim().endsWith('%')) continue;
        ctx.mutations.push({
          client: ctx.clientId,
          stage: 'quirk',
          action: 'warn-only',
          target: {
            loc: decl.loc,
            element: decl.element.tagName,
            property: 'width',
            value: decl.value,
          },
          feature: 'quirk-outlook-width',
          severity: 'warning',
          reason:
            `${ctx.profile.name} (Word engine) computes percentage widths against a different ` +
            `containing block, so \`width:${decl.value}\` on <${decl.element.tagName}> can expand to ` +
            `full width. Set a fixed pixel width on the table.`,
          evidence: 'https://www.caniemail.com/features/css-width/',
          fix:
            'Use a fixed-width <table width="600"> wrapped in an Outlook ghost table ' +
            '(<!--[if mso]><table width="600">…<![endif]-->) so Word renders a constrained column.',
        });
      }
    }
  }

  checkMobileFit(ctx);
}

/**
 * Output-level quirks that operate on the final serialized HTML.
 * Gmail clips messages past ~102 KB (often mid-element) and shows a
 * "[Message clipped]" link; approximated by cutting the serialized output.
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

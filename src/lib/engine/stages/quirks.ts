// Quirks stage: per-client rendering behaviors that go beyond feature support.
// (@media support is feature support and is handled by the CSS filter.)
//
//   - Outlook (Word): ignores max-width on non-table elements, computes
//     percentage widths differently, and drops margin on block elements.
//   - Gmail: clips messages larger than ~102 KB and shows a "[Message clipped]"
//     notice. Handled after serialization (it is a raw byte-level cut).
import type { Mutation } from '../types';
import type { StageContext } from './context';

const GMAIL_CLIP_DOC =
  'https://github.com/hteumeuleu/email-bugs/issues/41'; // documents Gmail's 102KB clipping

// Block-level elements whose CSS margin Word renders inconsistently.
const BLOCK_TAGS = new Set([
  'div', 'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li',
  'blockquote', 'section', 'header', 'footer', 'article', 'main', 'nav',
]);
const MARGIN_PROPS = new Set(['margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left']);

/** AST / stylesheet quirks. Runs before serialization. */
export function runQuirks(ctx: StageContext): void {
  const q = ctx.profile.quirks;

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

  // --- Outlook ignores/mis-renders margin on block elements ------------------
  if (q.unreliableBlockMargin) {
    for (const sheet of ctx.sheets) {
      for (const decl of sheet.declarations) {
        if (decl.expandedFrom) continue; // avoid duplicating expanded margin longhands
        if (!MARGIN_PROPS.has(decl.prop)) continue;
        if (!BLOCK_TAGS.has(decl.element.tagName)) continue;
        if (!/[1-9]/.test(decl.value)) continue; // skip margin:0
        ctx.mutations.push({
          client: ctx.clientId,
          stage: 'quirk',
          action: 'warn-only',
          target: {
            loc: decl.loc,
            element: decl.element.tagName,
            property: decl.prop,
            value: decl.value,
          },
          feature: 'quirk-outlook-margin',
          severity: 'warning',
          reason:
            `${ctx.profile.name} (Word engine) renders \`${decl.prop}\` on block elements like ` +
            `<${decl.element.tagName}> inconsistently and often drops it. Spacing may collapse.`,
          evidence: 'https://www.caniemail.com/features/css-margin/',
          fix: 'Move the spacing to padding on a wrapping <td> instead of margin on the block element.',
        });
      }
    }
  }
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

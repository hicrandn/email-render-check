import { describe, it, expect } from 'vitest';
import { simulate } from '@/src/lib/engine/engine';
import { evalCondition, revealConditionals } from '@/src/lib/engine/stages/mso';
import type { Mutation } from '@/src/lib/engine/types';

const byFeature = (muts: Mutation[], feature: string) => muts.filter((m) => m.feature === feature);

describe('conditional comments: expressions', () => {
  it.each([
    ['mso', true],
    ['!mso', false],
    ['gte mso 9', true],
    ['lt mso 12', false],
    ['mso 16', true],
    ['mso 12', false],
    ['IE', false],
    ['mso | IE', true],
    ['(gte mso 9)|(IE)', true],
    ['!mso & !IE', false],
    ['(mso)&(!IE)', true],
    ['nonsense', false],
  ])('%s is %s for Outlook', (expr, expected) => {
    expect(evalCondition(expr)).toBe(expected);
  });
});

describe('conditional comments: Outlook on Windows', () => {
  const ghost =
    '<body><!--[if mso]><table width="600"><tr><td><![endif]-->\n' +
    '<div style="max-width:600px">A</div>\n' +
    '<!--[if mso]></td></tr></table><![endif]-->' +
    '<!--[if !mso]><!--><p class="web">web only</p><!--<![endif]--></body>';

  it('reveals [if mso] content without moving anything', () => {
    const { html, blocks } = revealConditionals(ghost);
    expect(html).toHaveLength(ghost.length);
    expect(html.split('\n').length).toBe(ghost.split('\n').length);
    expect(blocks.map((b) => b.expr)).toEqual(['mso', 'mso']);
    expect(html).toContain('<table width="600">');
  });

  it('renders the ghost table and hides [if !mso] content', () => {
    const { html, mutations } = simulate(ghost, 'outlook-win');
    expect(html).toMatch(/<table width="600">[\s\S]*A[\s\S]*<\/table>/);
    expect(html).not.toContain('web only');
    expect(byFeature(mutations, 'quirk-outlook-conditional-shown')).toHaveLength(2);
    expect(byFeature(mutations, 'quirk-outlook-conditional-hidden')).toHaveLength(1);
  });

  it('leaves every other client as a browser would', () => {
    for (const client of ['gmail', 'outlook-com', 'apple-mail'] as const) {
      const { html, mutations } = simulate(ghost, client);
      expect(html.replace(/<!--[\s\S]*?-->/g, '')).not.toContain('<table');
      expect(html).toContain('web only');
      expect(mutations.some((m) => m.feature.startsWith('quirk-outlook-conditional'))).toBe(false);
    }
  });

  it('keeps Office settings XML out of the body', () => {
    const html =
      '<head><!--[if gte mso 9]><xml><o:OfficeDocumentSettings><o:PixelsPerInch>96</o:PixelsPerInch>' +
      '</o:OfficeDocumentSettings></xml><![endif]--></head><body><p>x</p></body>';
    expect(simulate(html, 'outlook-win').html).not.toMatch(/<body>[\s\S]*96/);
  });

  it('does not report CSS in content Outlook hides', () => {
    const html = '<body><p>a</p><!--[if !mso]><!--><div style="display:flex">x</div><!--<![endif]--></body>';
    expect(byFeature(simulate(html, 'outlook-win').mutations, 'css-display-flex')).toHaveLength(0);
  });
});

describe('VML and mso-hide', () => {
  const button =
    '<!--[if mso]><v:roundrect href="https://example.com" style="height:40px;v-text-anchor:middle;width:200px;" ' +
    'arcsize="10%" strokecolor="#1e3650" fill="t"><v:fill type="tile" color="#556270" /><w:anchorlock/>' +
    '<center style="color:#ffffff">Go</center></v:roundrect><![endif]-->';

  it('draws a bulletproof button as styled HTML', () => {
    const { html, mutations } = simulate(button, 'outlook-win');
    expect(html).not.toContain('v:roundrect');
    expect(html).not.toContain('w:anchorlock');
    expect(html).toMatch(/<div style="[^"]*width:200px[^"]*background-color:#556270[^"]*border-radius:4px[^"]*"><center/);
    expect(byFeature(mutations, 'quirk-outlook-vml')).toHaveLength(1);
  });

  it('hides mso-hide:all elements in Outlook only', () => {
    const html = '<span style="mso-hide:all">x</span>';
    expect(simulate(html, 'outlook-win').html).toContain('display:none');
    expect(simulate(html, 'gmail').html).not.toContain('display:none');
  });
});

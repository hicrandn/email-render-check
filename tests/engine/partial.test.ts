// Partial-support rules, run against the real notes in the snapshot. If Can I
// Email rewords a note, its rule stops applying and these tests say which.
import { describe, it, expect } from 'vitest';
import { supportFor } from '@/src/lib/engine/data/snapshot';
import {
  judgeDeclaration,
  judgeMedia,
  judgeSelector,
  nestingFlattens,
  styleElementLimits,
  unsupportedTag,
  type DeclSubject,
} from '@/src/lib/engine/stages/partial';
import type { ClientId } from '@/src/lib/engine/types';

const decl = (slug: string, client: ClientId, s: DeclSubject) =>
  judgeDeclaration(supportFor(slug, client), s)?.kind;

describe('partial: element restrictions (Outlook on Windows)', () => {
  it('padding works on table cells only', () => {
    expect(decl('css-padding', 'outlook-win', { prop: 'padding', value: '8px', element: 'a' })).toBe('remove');
    // Kept; a "Buggy" note about row heights still warrants a warning.
    expect(decl('css-padding', 'outlook-win', { prop: 'padding', value: '8px', element: 'td' })).toBe('warn');
    // A <style> rule names no element: can't tell.
    expect(decl('css-padding', 'outlook-win', { prop: 'padding', value: '8px' })).toBe('warn');
  });

  it('width and height do not work on <div>, <p>, <span>', () => {
    expect(decl('css-width', 'outlook-win', { prop: 'width', value: '300px', element: 'div' })).toBe('remove');
    expect(decl('css-width', 'outlook-win', { prop: 'width', value: '300px', element: 'table' })).toBe('ok');
    expect(decl('css-height', 'outlook-win', { prop: 'height', value: '20px', element: 'p' })).toBe('remove');
  });

  it('max-width works on <table> only', () => {
    expect(decl('css-max-width', 'outlook-win', { prop: 'max-width', value: '600px', element: 'div' })).toBe('remove');
    expect(decl('css-max-width', 'outlook-win', { prop: 'max-width', value: '600px', element: 'table' })).toBe('ok');
  });

  it('display: only none, and not on images', () => {
    expect(decl('css-display', 'outlook-win', { prop: 'display', value: 'inline-block', element: 'a' })).toBe('remove');
    expect(decl('css-display-none', 'outlook-win', { prop: 'display', value: 'none', element: 'img' })).toBe('remove');
    // An inline image would gain a gap Word doesn't draw.
    expect(decl('css-display', 'outlook-win', { prop: 'display', value: 'block', element: 'img' })).toBe('warn');
  });
});

describe('partial: values', () => {
  it('negative margins and indents', () => {
    expect(decl('css-margin', 'gmail', { prop: 'margin', value: '-4px 0', element: 'p' })).toBe('remove');
    expect(decl('css-margin', 'gmail', { prop: 'margin', value: '4px 0', element: 'p' })).toBe('ok');
    expect(decl('css-text-indent', 'yahoo', { prop: 'text-indent', value: '-1em' })).toBe('remove');
  });

  it('Word drops auto margins but keeps the other sides', () => {
    const j = judgeDeclaration(supportFor('css-margin', 'outlook-win'), { prop: 'margin', value: '0 auto', element: 'table' });
    expect(j).toMatchObject({ kind: 'rewrite', value: '0 0' });
  });

  it('Word renders numeric weights as normal or bold, and caps borders at 8px', () => {
    expect(judgeDeclaration(supportFor('css-font-weight', 'outlook-win'), { prop: 'font-weight', value: '500' }))
      .toMatchObject({ kind: 'rewrite', value: 'normal' });
    expect(judgeDeclaration(supportFor('css-font-weight', 'outlook-win'), { prop: 'font-weight', value: '600' }))
      .toMatchObject({ kind: 'rewrite', value: 'bold' });
    expect(judgeDeclaration(supportFor('css-border', 'outlook-win'), { prop: 'border', value: '10px solid red' }))
      .toMatchObject({ kind: 'rewrite', value: '8px solid red' });
  });

  it('unsupported keywords and units', () => {
    expect(decl('css-text-transform', 'outlook-win', { prop: 'text-transform', value: 'lowercase' })).toBe('remove');
    expect(decl('css-text-transform', 'outlook-win', { prop: 'text-transform', value: 'uppercase' })).toBe('ok');
    expect(decl('css-font-size', 'yahoo', { prop: 'font-size', value: '1.2rem' })).toBe('remove');
    expect(decl('css-font-size', 'yahoo', { prop: 'font-size', value: '16px' })).toBe('ok');
    expect(decl('css-position', 'yahoo', { prop: 'position', value: 'absolute' })).toBe('remove');
    expect(decl('css-position', 'yahoo', { prop: 'position', value: 'relative' })).toBe('ok');
    expect(decl('css-text-align', 'yahoo', { prop: 'text-align', value: 'start' })).toBe('remove');
    expect(decl('css-font-weight', 'yahoo', { prop: 'font-weight', value: '650' })).toBe('remove');
    expect(decl('css-font-weight', 'yahoo', { prop: 'font-weight', value: '700' })).toBe('ok');
  });

  it('gap: only column-gap, for flexbox', () => {
    expect(decl('css-gap', 'gmail', { prop: 'gap', value: '16px' })).toBe('remove');
    expect(decl('css-gap', 'gmail', { prop: 'column-gap', value: '16px' })).toBe('ok');
  });

  it('Yahoo turns height into min-height', () => {
    expect(judgeDeclaration(supportFor('css-height', 'yahoo'), { prop: 'height', value: '40px' }))
      .toMatchObject({ kind: 'rewrite', prop: 'min-height', value: '40px' });
  });

  it('space-separated rgb(): Gmail drops the whole attribute or <style>', () => {
    const s = { prop: 'color', value: 'rgb(0 128 0)' };
    expect(decl('css-rgb', 'gmail', { ...s, element: 'p' })).toBe('strip-attribute');
    expect(decl('css-rgb', 'gmail', s)).toBe('strip-block');
    expect(decl('css-rgb', 'yahoo', s)).toBe('remove');
    expect(decl('css-rgb', 'gmail', { prop: 'color', value: 'rgb(0, 128, 0)' })).toBe('ok');
  });

  it('modern color syntax drops every inline style in Gmail', () => {
    expect(decl('css-modern-color', 'gmail', { prop: 'color', value: 'oklch(70% 0.1 200)', element: 'p' }))
      .toBe('strip-attribute');
    expect(decl('css-modern-color', 'gmail', { prop: 'color', value: 'oklch(70% 0.1 200)' })).toBeUndefined();
  });
});

describe('partial: @media, selectors, elements', () => {
  it('@media', () => {
    expect(judgeMedia(supportFor('css-at-media', 'gmail'), '(max-height: 500px)', false).kind).toBe('remove');
    expect(judgeMedia(supportFor('css-at-media', 'gmail'), '(max-width: 600px)', false).kind).toBe('ok');
    expect(judgeMedia(supportFor('css-at-media', 'yahoo'), 'only screen and (max-width: 600px)', false).kind).toBe('ok');
    expect(judgeMedia(supportFor('css-at-media', 'yahoo'), '(orientation: landscape)', false).kind).toBe('remove');
    expect(judgeMedia(supportFor('css-at-media', 'outlook-com'), '(max-width: 600px)', true).kind).toBe('remove');
    expect(judgeMedia(supportFor('css-at-media', 'outlook-com'), '(max-width: 600px)', false).kind).toBe('ok');
  });

  it('pseudo-classes after a type selector only (Outlook.com)', () => {
    const hover = supportFor('css-pseudo-class-hover', 'outlook-com');
    expect(judgeSelector(hover, { hasType: false }).kind).toBe('remove');
    expect(judgeSelector(hover, { hasType: true }).kind).toBe('ok');
  });

  it('attribute selector syntaxes', () => {
    const gmail = supportFor('css-selector-attribute', 'gmail');
    expect(judgeSelector(gmail, { hasType: false, operator: '~=', attribute: 'class' }).kind).toBe('ok');
    expect(judgeSelector(gmail, { hasType: false, operator: '=', attribute: 'class' }).kind).toBe('remove');
    expect(judgeSelector(gmail, { hasType: false, operator: '~=', attribute: 'title' }).kind).toBe('remove');
    const yahoo = supportFor('css-selector-attribute', 'yahoo');
    expect(judgeSelector(yahoo, { hasType: false, operator: '=', attribute: 'lang' }).kind).toBe('ok');
    expect(judgeSelector(yahoo, { hasType: false, operator: '', attribute: 'lang' }).kind).toBe('remove');
  });

  it('semantic elements each client keeps', () => {
    expect(unsupportedTag(supportFor('html-semantics', 'gmail'), 'nav')).toBe(true);
    expect(unsupportedTag(supportFor('html-semantics', 'gmail'), 'section')).toBe(false);
    expect(unsupportedTag(supportFor('html-semantics', 'outlook-com'), 'time')).toBe(false);
    expect(unsupportedTag(supportFor('html-semantics', 'outlook-com'), 'header')).toBe(true);
  });

  it("Gmail's <style> limits, and Yahoo's nesting", () => {
    expect(styleElementLimits(supportFor('html-style', 'gmail'))).toEqual({ inBody: false, maxKB: 16, other: false });
    expect(styleElementLimits(supportFor('html-style', 'outlook-win')).other).toBe(true);
    expect(nestingFlattens(supportFor('css-nesting', 'yahoo'))).toBe(true);
    expect(nestingFlattens(supportFor('css-nesting', 'gmail'))).toBe(false);
  });
});

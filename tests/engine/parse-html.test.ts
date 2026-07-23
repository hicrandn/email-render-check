import { describe, it, expect } from 'vitest';
import { parseHtml, walkElements, type Element } from '@/src/lib/engine/parse/html';

describe('walkElements', () => {
  it('visits elements in pre-order document order, same as before the iterative rewrite', () => {
    const html = '<div id="a"><span id="b"></span><p id="c"><b id="d"></b></p></div>';
    const parsed = parseHtml(html);
    const visited: string[] = [];
    walkElements(parsed.document, (el) => visited.push(el.attrs.find((a) => a.name === 'id')?.value ?? el.tagName));
    expect(visited).toContain('a');
    expect(visited.indexOf('a')).toBeLessThan(visited.indexOf('b'));
    expect(visited.indexOf('b')).toBeLessThan(visited.indexOf('c'));
    expect(visited.indexOf('c')).toBeLessThan(visited.indexOf('d'));
  });

  it('reports the correct parent for each visited element', () => {
    const html = '<div id="a"><span id="b"></span></div>';
    const parsed = parseHtml(html);
    let parentOfB: Element | undefined;
    walkElements(parsed.document, (el, parent) => {
      if (el.attrs.some((a) => a.name === 'id' && a.value === 'b')) parentOfB = parent as Element;
    });
    expect(parentOfB?.attrs.some((a) => a.name === 'id' && a.value === 'a')).toBe(true);
  });

  it('does not throw on extremely deep nesting (used to blow the call stack ~depth 3000-5000)', () => {
    const depth = 20000;
    const html = `<html><body>${'<div>'.repeat(depth)}x${'</div>'.repeat(depth)}</body></html>`;
    const parsed = parseHtml(html);
    let count = 0;
    expect(() => walkElements(parsed.document, () => count++)).not.toThrow();
    // html + auto-inserted head + body + `depth` divs
    expect(count).toBe(depth + 3);
  });
});

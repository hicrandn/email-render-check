// Offset <-> (line, column) conversion for a given source string.
// Lines and columns are 1-based, matching parse5 and postcss conventions.

export class LineIndex {
  /** lineStart[i] = absolute offset where line (i+1) begins. */
  private readonly lineStart: number[];

  constructor(source: string) {
    const starts = [0];
    for (let i = 0; i < source.length; i++) {
      if (source.charCodeAt(i) === 10 /* \n */) starts.push(i + 1);
    }
    this.lineStart = starts;
  }

  toLineCol(offset: number): { line: number; col: number } {
    // Binary search for the greatest lineStart <= offset.
    let lo = 0;
    let hi = this.lineStart.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (this.lineStart[mid] <= offset) lo = mid;
      else hi = mid - 1;
    }
    return { line: lo + 1, col: offset - this.lineStart[lo] + 1 };
  }
}

/**
 * Combine a base position (where a CSS fragment starts in the HTML) with a
 * position that postcss reported *relative to that fragment*.
 */
export function combinePosition(
  base: { line: number; col: number },
  rel: { line: number; column: number },
): { line: number; col: number } {
  if (rel.line === 1) {
    return { line: base.line, col: base.col + rel.column - 1 };
  }
  return { line: base.line + rel.line - 1, col: rel.column };
}

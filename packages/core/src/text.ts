// Offset <-> line/column conversions. Lines and columns are 1-based.

export type Position = { line: number; column: number }

export function position(text: string, offset: number): Position {
  let line = 1
  let lineStart = 0
  for (let i = text.indexOf("\n"); i !== -1 && i < offset; i = text.indexOf("\n", i + 1)) {
    line++
    lineStart = i + 1
  }
  return { line, column: offset - lineStart + 1 }
}

export function splitLines(text: string): string[] {
  return text.split(/\r?\n/)
}

export function lineText(text: string, line: number): string {
  return splitLines(text)[line - 1] ?? ""
}

/** The offset of the end of a line (before its newline), clamped to the document. */
export function lineEnd(text: string, line: number): number {
  let offset = 0
  for (let l = 1; l < line; l++) {
    const next = text.indexOf("\n", offset)
    if (next === -1) break
    offset = next + 1
  }
  const end = text.indexOf("\n", offset)
  const stop = end === -1 ? text.length : end
  return stop > offset && text[stop - 1] === "\r" ? stop - 1 : stop
}

export function isLineStart(text: string, offset: number): boolean {
  return offset === 0 || text[offset - 1] === "\n"
}

export function eolOf(text: string): string {
  return text.includes("\r\n") ? "\r\n" : "\n"
}

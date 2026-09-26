// Bracket structure, for moving by blocks. A language-agnostic heuristic: it skips string literals
// and C-style comments, and ignores closing brackets that don't match.

const PAIRS: Record<string, string> = { "(": ")", "[": "]", "{": "}" }
const CLOSERS = new Set(Object.values(PAIRS))

export type OpenBracket = { offset: number; char: string }

/** Calls `visit` for every bracket outside strings and comments in `[from, to)`; stops when it returns true. */
function scan(text: string, from: number, to: number, visit: (offset: number, char: string) => boolean): void {
  let i = from
  while (i < to) {
    const ch = text[i]!
    const next = text[i + 1]
    if (ch === "/" && next === "/") {
      const end = text.indexOf("\n", i)
      i = end === -1 ? to : end
    } else if (ch === "/" && next === "*") {
      const end = text.indexOf("*/", i + 2)
      i = end === -1 ? to : end + 2
    } else if (ch === '"' || ch === "'" || ch === "`") {
      i = stringEnd(text, i, to)
    } else {
      if ((PAIRS[ch] || CLOSERS.has(ch)) && visit(i, ch)) return
      i++
    }
  }
}

/** Just past the string starting at `start`. Quotes other than backticks end at the line's end too. */
function stringEnd(text: string, start: number, to: number): number {
  const quote = text[start]!
  for (let i = start + 1; i < to; i++) {
    const ch = text[i]
    if (ch === "\\") i++
    else if (ch === quote) return i + 1
    else if (ch === "\n" && quote !== "`") return i
  }
  return to
}

/** The brackets still open at `offset`, outermost first. */
export function openBrackets(text: string, offset: number): OpenBracket[] {
  const stack: OpenBracket[] = []
  scan(text, 0, offset, (at, char) => {
    if (PAIRS[char]) stack.push({ offset: at, char })
    else if (stack.length > 0 && PAIRS[stack.at(-1)!.char] === char) stack.pop()
    return false
  })
  return stack
}

/** The offset of the bracket closing `open`, if it is closed. */
export function closingBracket(text: string, open: OpenBracket): number | undefined {
  const stack: string[] = []
  let found: number | undefined
  scan(text, open.offset + 1, text.length, (at, char) => {
    if (PAIRS[char]) stack.push(char)
    else if (stack.length === 0) {
      if (PAIRS[open.char] !== char) return false
      found = at
      return true
    } else if (PAIRS[stack.at(-1)!] === char) stack.pop()
    return false
  })
  return found
}

/** Just inside the bracket at `close`: the end of the pair's contents, before any whitespace. */
export function contentsEnd(text: string, open: OpenBracket, close: number): number {
  let i = close
  while (i > open.offset + 1 && /\s/.test(text[i - 1]!)) i--
  return i
}

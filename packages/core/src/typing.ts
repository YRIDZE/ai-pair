// Typing cadence and reading time. See "Playback" in DESIGN.md.

export type Cadence = {
  /** Characters per second. */
  rate: number
  /** Relative per-character jitter, e.g. 0.3 for ±30%. */
  jitter: number
  punctuationPauseMs: number
  newlinePauseMs: number
}

/** A piece of text inserted in one edit, after waiting `delay` ms. */
export type Chunk = { text: string; delay: number }

const PAUSE_AFTER = new Set([",", ";", ")", "}"])

function isIndent(ch: string | undefined): boolean {
  return ch === " " || ch === "\t"
}

/**
 * Splits text into chunks: one per character, except that a newline and the
 * indentation after it are inserted together, as an editor's auto-indent would.
 * Indentation at the very start is inserted at once too, if `atLineStart`.
 */
export function planTyping(text: string, cadence: Cadence, atLineStart: boolean, random: () => number): Chunk[] {
  const chars = Array.from(text)
  const base = 1000 / cadence.rate
  const chunks: Chunk[] = []
  let pause = 0
  let i = 0

  const takeIndent = (): string => {
    let indent = ""
    while (isIndent(chars[i])) indent += chars[i++]
    return indent
  }

  if (atLineStart) {
    const indent = takeIndent()
    if (indent) chunks.push({ text: indent, delay: 0 })
  }

  while (i < chars.length) {
    const ch = chars[i++]!
    const delay = base * (1 + (random() * 2 - 1) * cadence.jitter) + pause
    if (ch === "\n") {
      chunks.push({ text: ch + takeIndent(), delay })
      pause = cadence.newlinePauseMs
    } else {
      chunks.push({ text: ch, delay })
      pause = PAUSE_AFTER.has(ch) ? cadence.punctuationPauseMs : 0
    }
  }
  return chunks
}

export type Reading = { msPerWord: number; minMs: number; maxMs: number }

export function readingTime(text: string, reading: Reading): number {
  const words = text.split(/\s+/).filter(Boolean).length
  return Math.min(reading.maxMs, Math.max(reading.minMs, words * reading.msPerWord))
}

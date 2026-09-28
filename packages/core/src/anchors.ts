// Anchor resolution. See "Anchors" in PROTOCOL.md.

import { CURSOR_MARKER, type Anchor, type Candidate, type ErrorKind, type Span, type Spot } from "@ai-pair/protocol"
import { lineText, position } from "./text"

export type Range = { start: number; end: number }

export type Resolution =
  | { ok: true; range: Range }
  | { ok: false; kind: ErrorKind; message: string; candidates?: Candidate[] }

const MAX_CANDIDATES = 20

function findAll(text: string, needle: string): number[] {
  const starts: number[] = []
  if (needle === "") return starts
  for (let i = text.indexOf(needle); i !== -1; i = text.indexOf(needle, i + 1)) {
    starts.push(i)
  }
  return starts
}

function candidates(text: string, starts: number[]): Candidate[] {
  return starts.slice(0, MAX_CANDIDATES).map((start) => {
    const { line } = position(text, start)
    return { line, context: lineText(text, line).trim() }
  })
}

/** Text copied from a report's code may carry the cursor marker. */
function unmarked(text: string): string {
  return text.replaceAll(CURSOR_MARKER, "")
}

/** Resolves an anchor in `text`: a unique match, or the one closest to `near_line`. */
export function resolveAnchor(text: string, anchor: Anchor): Resolution {
  anchor = { ...anchor, text: unmarked(anchor.text) }
  const starts = findAll(text, anchor.text)
  const range = (start: number): Resolution => ({
    ok: true,
    range: { start, end: start + anchor.text.length },
  })

  if (starts.length === 0) {
    return { ok: false, kind: "anchor_not_found", message: `Text not found: ${JSON.stringify(anchor.text)}` }
  }
  if (starts.length === 1) return range(starts[0]!)

  if (anchor.near_line !== undefined) {
    const target = anchor.near_line
    let best = starts[0]!
    for (const s of starts) {
      if (Math.abs(position(text, s).line - target) < Math.abs(position(text, best).line - target)) best = s
    }
    return range(best)
  }

  return {
    ok: false,
    kind: "anchor_ambiguous",
    message: `${starts.length} matches for ${JSON.stringify(anchor.text)}; make it longer to be unique, or add near_line`,
    candidates: candidates(text, starts),
  }
}

/**
 * Resolves a spot: where the cursor marker is in `at`, found by the text around it, on `line`. The
 * line is exact: a match elsewhere doesn't count, and is only listed, to show where the text is.
 * `at` has exactly one marker; see `moveProblem`.
 */
export function resolveSpot(text: string, spot: Spot): Resolution {
  const { whole, found } = findSpot(text, spot.at)
  const here = found.filter((at) => position(text, at).line === spot.line)
  if (here.length === 1) return { ok: true, range: { start: here[0]!, end: here[0]! } }
  if (here.length > 1) {
    return {
      ok: false,
      kind: "anchor_ambiguous",
      message: `${JSON.stringify(whole)} occurs ${here.length} times on line ${spot.line}; give \`at\` more text around ▌ to be unique`,
    }
  }
  const reads = `line ${spot.line} reads ${JSON.stringify(lineText(text, spot.line))}`
  if (found.length === 0) {
    return { ok: false, kind: "anchor_not_found", message: `Text not found: ${JSON.stringify(whole)}; ${reads}` }
  }
  return {
    ok: false,
    kind: "anchor_not_found",
    message: `The spot isn't on line ${spot.line}: ${reads}. It's on these lines:`,
    candidates: candidates(text, found),
  }
}

/** Where a spot's text occurs: the offsets of its marker, in each match. */
function findSpot(text: string, at: string): { whole: string; found: number[] } {
  const marker = at.indexOf(CURSOR_MARKER)
  const before = at.slice(0, marker)
  const whole = before + at.slice(marker + CURSOR_MARKER.length)
  return { whole, found: findAll(text, whole).map((start) => start + before.length) }
}

/** The lines a spot's text is on, anywhere in `text`. */
export function spotCandidates(text: string, at: string): Candidate[] {
  return candidates(text, findSpot(text, at).found)
}

/** Resolves a single anchor, or a from/to range: `to` is its first match after `from`. */
export function resolveSpan(text: string, span: Span): Resolution {
  if (!("from" in span)) return resolveAnchor(text, span)
  const start = resolveAnchor(text, span.from)
  if (!start.ok) return start
  const to = unmarked(span.to.text)
  const end = to === "" ? -1 : text.indexOf(to, start.range.end)
  if (end === -1) return { ok: false, kind: "anchor_not_found", message: `Text not found after \`from\`: ${JSON.stringify(to)}` }
  return { ok: true, range: { start: start.range.start, end: end + to.length } }
}

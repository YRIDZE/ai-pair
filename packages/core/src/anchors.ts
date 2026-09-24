// Anchor resolution. See "Anchors" in PROTOCOL.md.

import type { Anchor, Candidate, ErrorKind, Span } from "@ai-pair/protocol"
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

/** Resolves an anchor in `text`. `from` is the reference offset for `direction`. */
export function resolveAnchor(text: string, anchor: Anchor, from: number): Resolution {
  const starts = findAll(text, anchor.text)
  const range = (start: number): Resolution => ({
    ok: true,
    range: { start, end: start + anchor.text.length },
  })

  if (starts.length === 0) {
    return { ok: false, kind: "anchor_not_found", message: `Text not found: ${JSON.stringify(anchor.text)}` }
  }
  if (starts.length === 1) return range(starts[0]!)

  if (anchor.direction !== undefined) {
    const start =
      anchor.direction === "forward" ? starts.find((s) => s >= from) : starts.findLast((s) => s < from)
    if (start !== undefined) return range(start)
    return {
      ok: false,
      kind: "anchor_not_found",
      message: `No match ${anchor.direction} of the agent cursor for ${JSON.stringify(anchor.text)}`,
      candidates: candidates(text, starts),
    }
  }

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
    message: `${starts.length} matches for ${JSON.stringify(anchor.text)}; add near_line or direction`,
    candidates: candidates(text, starts),
  }
}

/** Resolves a single anchor, or a from/to range (`to` is resolved relative to the end of `from`). */
export function resolveSpan(text: string, span: Span, from: number): Resolution {
  if (!("from" in span)) return resolveAnchor(text, span, from)
  const start = resolveAnchor(text, span.from, from)
  if (!start.ok) return start
  const end = resolveAnchor(text, span.to, start.range.end)
  if (!end.ok) return end
  return {
    ok: true,
    range: {
      start: Math.min(start.range.start, end.range.start),
      end: Math.max(start.range.end, end.range.end),
    },
  }
}

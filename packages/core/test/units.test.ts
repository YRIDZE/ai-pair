import { describe, expect, it } from "vitest"
import { resolveAnchor, resolveSpan } from "../src/anchors"
import { planTyping, readingTime } from "../src/typing"
import { terminalText } from "../src/text"

describe("terminal text", () => {
  it("drops colors and shell integration sequences, and resolves progress overwrites", () => {
    const raw = "\x1b]633;C\x07\x1b[32m✓\x1b[0m 4 passed\r\n 10%\r 50%\r100%\r\n\x1b]633;D;0\x07"
    expect(terminalText(raw)).toBe("✓ 4 passed\n100%")
  })
})

describe("anchors", () => {
  const text = "a = 1\nb = 1\nc = 1\n"

  it("resolves a unique match", () => {
    expect(resolveAnchor(text, { text: "b = " }, 0)).toEqual({ ok: true, range: { start: 6, end: 10 } })
  })

  it("reports a missing match", () => {
    expect(resolveAnchor(text, { text: "d" }, 0)).toMatchObject({ ok: false, kind: "anchor_not_found" })
  })

  it("reports ambiguity with candidates", () => {
    expect(resolveAnchor(text, { text: "1" }, 0)).toMatchObject({
      ok: false,
      kind: "anchor_ambiguous",
      candidates: [
        { line: 1, context: "a = 1" },
        { line: 2, context: "b = 1" },
        { line: 3, context: "c = 1" },
      ],
    })
  })

  it("breaks ties by the nearest line", () => {
    expect(resolveAnchor(text, { text: "1", near_line: 3 }, 0)).toEqual({ ok: true, range: { start: 16, end: 17 } })
  })

  it("breaks ties by direction from the cursor", () => {
    expect(resolveAnchor(text, { text: "1", direction: "forward" }, 5)).toEqual({ ok: true, range: { start: 10, end: 11 } })
    expect(resolveAnchor(text, { text: "1", direction: "backward" }, 10)).toEqual({ ok: true, range: { start: 4, end: 5 } })
  })

  it("resolves a from/to span", () => {
    expect(resolveSpan(text, { from: { text: "b" }, to: { text: "1", direction: "forward" } }, 0)).toEqual({
      ok: true,
      range: { start: 6, end: 11 },
    })
  })
})

describe("typing", () => {
  const cadence = { charMs: 100, jitter: 0, wordStartMs: 50, punctuationMs: 30, openBracketMs: 20, newlineMs: 250 }
  const delays = (text: string, atLineStart = false) =>
    planTyping(text, cadence, atLineStart, Math.random).map((c) => [c.text, c.delay])

  it("pauses as words start, and after punctuation and opening brackets", () => {
    expect(delays("ab c(d, e")).toEqual([
      ["a", 100],
      ["b", 100],
      [" ", 100],
      ["c", 150],
      ["(", 100],
      ["d", 170],
      [",", 100],
      [" ", 130],
      ["e", 150],
    ])
  })

  it("inserts a newline together with the following indentation, then pauses", () => {
    expect(delays("x\n  y")).toEqual([
      ["x", 100],
      ["\n  ", 100],
      ["y", 400],
    ])
  })

  it("inserts leading indentation at once at the start of a line", () => {
    expect(delays("  x", true).map(([t]) => t)).toEqual(["  ", "x"])
    expect(delays("  x").map(([t]) => t)).toEqual([" ", " ", "x"])
  })

  it("scales every delay for type_fast", () => {
    expect(planTyping("a b", cadence, false, Math.random, 0.5).map((c) => c.delay)).toEqual([50, 50, 75])
  })

  it("scales reading time with the word count, within bounds", () => {
    const reading = { msPerWord: 180, minMs: 1000, maxMs: 6000 }
    expect(readingTime("Hi.", reading)).toBe(1000)
    expect(readingTime(Array(10).fill("word").join(" "), reading)).toBe(1800)
    expect(readingTime(Array(100).fill("word").join(" "), reading)).toBe(6000)
  })
})

import { describe, expect, it } from "vitest"
import { resolveAnchor, resolveSpan } from "../src/anchors"
import { planTyping, readingTime } from "../src/typing"

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
  const cadence = { rate: 10, jitter: 0, punctuationPauseMs: 50, newlinePauseMs: 250 }

  it("inserts a newline together with the following indentation", () => {
    const chunks = planTyping("a,\n  b", cadence, false, Math.random)
    expect(chunks).toEqual([
      { text: "a", delay: 100 },
      { text: ",", delay: 100 },
      { text: "\n  ", delay: 150 },
      { text: "b", delay: 350 },
    ])
  })

  it("inserts leading indentation at once at the start of a line", () => {
    expect(planTyping("  x", cadence, true, Math.random).map((c) => c.text)).toEqual(["  ", "x"])
    expect(planTyping("  x", cadence, false, Math.random).map((c) => c.text)).toEqual([" ", " ", "x"])
  })

  it("scales reading time with the word count, within bounds", () => {
    const reading = { msPerWord: 180, minMs: 1000, maxMs: 6000 }
    expect(readingTime("Hi.", reading)).toBe(1000)
    expect(readingTime(Array(10).fill("word").join(" "), reading)).toBe(1800)
    expect(readingTime(Array(100).fill("word").join(" "), reading)).toBe(6000)
  })
})

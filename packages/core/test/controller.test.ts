import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { advance, setup, track, until } from "./fake"

beforeEach(() => {
  vi.useFakeTimers()
})
afterEach(() => {
  vi.useRealTimers()
})

// With the test config, a beat is 100 ms and `type` takes 100 ms per character.

describe("timing", () => {
  it("returns the first step immediately and blocks the second until the first finishes", async () => {
    const { editor, controller } = setup({ "a.ts": "" })
    await controller.start()

    const first = await until(controller.step([{ move: { file: "a.ts" } }, { type: "abc" }]))
    expect(first.batches).toEqual([])
    expect(first.submitted).toEqual({ id: 1, status: "playing" })

    const secondCall = controller.step([{ type: "d" }])
    const second = track(secondCall)
    await advance(300)
    expect(second.done).toBe(false)
    expect(editor.text("a.ts")).toBe("ab")

    const report = await until(secondCall)
    expect(report.batches).toEqual([{ id: 1, status: "completed", played: 2 }])
    expect(report.submitted).toEqual({ id: 2, status: "playing" })

    await advance(200)
    expect(editor.text("a.ts")).toBe("abcd")
  })

  it("returns with `waiting` after MAX_BLOCK", async () => {
    const { controller } = setup({ "a.ts": "" }, { maxBlockMs: 1000 })
    await controller.start()
    await controller.step([{ move: { file: "a.ts" } }])
    const report = await until(controller.listen())
    expect(report.waiting).toBe(true)
    expect(report.batches).toEqual([{ id: 1, status: "completed", played: 1 }])
  })

  it("holds playback while paused and continues on resume", async () => {
    const { editor, controller } = setup({ "a.ts": "" })
    await controller.start()
    controller.pause()
    await controller.step([{ move: { file: "a.ts" } }, { type: "abc" }])
    await advance(2000)
    expect(editor.text("a.ts")).toBe("")
    expect(editor.state).toBe("paused")

    controller.resume()
    await advance(1000)
    expect(editor.text("a.ts")).toBe("abc")
  })
})

describe("editing", () => {
  it("types with one undo stop per action and instant indentation", async () => {
    const { editor, controller } = setup({ "a.ts": "" })
    await controller.start()
    await controller.step([{ move: { file: "a.ts" } }, { type: "{\n  y\n}" }])
    await until(controller.step([]))
    expect(editor.text("a.ts")).toBe("{\n  y\n}")
    expect(editor.edits.map((e) => e.text)).toEqual(["{", "\n  ", "y", "\n", "}"])
    expect(editor.edits.map((e) => [e.options.undoStopBefore, e.options.undoStopAfter])).toEqual([
      [true, false],
      [false, false],
      [false, false],
      [false, false],
      [false, true],
    ])
  })

  it("replaces a selection by typing, and deletes a selection", async () => {
    const { editor, controller } = setup({ "a.ts": "const a = 1\n" })
    await controller.start()
    await controller.step([{ move: { file: "a.ts" } }, { select: { text: "1" } }, { type: "2" }])
    await until(controller.step([{ select: { text: "const " } }, { delete: true }]))
    await until(controller.step([]))
    expect(editor.text("a.ts")).toBe("a = 2\n")
  })

  it("creates a file on move and saves edited files after each batch", async () => {
    const { editor, controller } = setup()
    await controller.start()
    await controller.step([{ move: { file: "new.ts" } }, { type_fast: "x" }])
    await until(controller.step([]))
    expect(editor.text("new.ts")).toBe("x")
    expect(editor.saved).toEqual(["/project/new.ts"])
  })

  it("fails a batch on an ambiguous anchor, listing candidates, and discards the next batch", async () => {
    const { controller } = setup({ "a.ts": "x\nx\n" })
    await controller.start()
    await controller.step([{ move: { file: "a.ts" } }, { move: { text: "x" } }])
    const report = await until(controller.step([{ type: "y" }]))
    expect(report.batches).toEqual([
      {
        id: 1,
        status: "failed",
        played: 1,
        unplayed: [{ move: { text: "x" } }],
        error: {
          index: 1,
          kind: "anchor_ambiguous",
          message: expect.any(String),
          candidates: [
            { line: 1, context: "x" },
            { line: 2, context: "x" },
          ],
        },
      },
      { id: 2, status: "discarded", played: 0, unplayed: [{ type: "y" }] },
    ])
  })
})

describe("interruptions", () => {
  it("reports exactly what was typed and discards the queued batch", async () => {
    const { editor, controller } = setup({ "a.ts": "" })
    await controller.start()
    await controller.step([{ move: { file: "a.ts" } }, { type: "hello world" }])
    const second = controller.step([{ type: "!" }])

    await advance(450)
    expect(editor.text("a.ts")).toBe("hel")
    controller.userMessage("use zod")

    const report = await until(second)
    expect(report).toMatchObject({
      batches: [
        { id: 1, status: "interrupted", played: 1, partial: { index: 1, typed: "hel" }, unplayed: [] },
        { id: 2, status: "discarded", played: 0, unplayed: [{ type: "!" }] },
      ],
      submitted: { id: 2, status: "discarded" },
      events: [{ kind: "message", text: "use zod" }],
    })
    await advance(1000)
    expect(editor.text("a.ts")).toBe("hel")
  })

  it("discards a batch planned before an interruption the agent hasn't seen", async () => {
    const { editor, controller } = setup({ "a.ts": "" })
    await controller.start()
    await controller.step([{ move: { file: "a.ts" } }, { type: "ab" }])
    await advance(1000)
    controller.userInterrupt()

    const stale = await controller.step([{ type: "c" }])
    expect(stale.batches.map((b) => [b.id, b.status])).toEqual([
      [1, "completed"],
      [2, "discarded"],
    ])
    expect(stale.events).toEqual([{ kind: "interrupt" }])

    const fresh = await controller.step([{ type: "c" }])
    expect(fresh.submitted).toEqual({ id: 3, status: "playing" })
    await advance(500)
    expect(editor.text("a.ts")).toBe("abc")
  })

  it("reports programmer edits as diffs and moves the agent cursor with them", async () => {
    const { editor, controller } = setup({ "a.ts": "hello\n" })
    await controller.start()
    await controller.step([{ move: { file: "a.ts", text: "hello" } }])
    const listen = controller.listen()
    const listening = track(listen)
    await advance(500)
    expect(listening.done).toBe(false)

    editor.userEdit("a.ts", 0, 0, "XX")
    const report = await until(listen)
    expect(report.events).toEqual([{ kind: "edit", file: "a.ts", diff: expect.stringContaining("+XXhello") }])
    expect(report.cursor).toEqual({ file: "a.ts", line: 1, column: 8 })
  })
})

describe("turns", () => {
  it("lets the agent only comment during the programmer's turn", async () => {
    const { editor, controller } = setup({ "a.ts": "for (i <= n)\n" })
    await controller.start()
    await controller.step([{ move: { file: "a.ts" } }])
    await advance(500)

    controller.takeTurn()
    const taken = await until(controller.listen())
    expect(taken.turn).toBe("user")
    expect(taken.events).toEqual([{ kind: "turn", to: "user" }])

    await controller.step([{ type: "x" }])
    const refused = await until(controller.listen())
    expect(refused.batches[0]).toMatchObject({ status: "failed", error: { kind: "not_your_turn" } })

    await controller.step([{ point: { text: "<=" } }, { say: "Careful, this goes one past the end." }])
    await advance(3000)
    expect(editor.point).toEqual({ file: "/project/a.ts", start: 7, end: 9 })

    // Edits are reported once the programmer pauses typing.
    const following = track(controller.listen())
    editor.userEdit("a.ts", 7, 2, "<")
    await advance(500)
    expect(following.done).toBe(false)
    await advance(600)
    expect(following.done).toBe(true)
    expect(following.value!.events).toEqual([{ kind: "edit", file: "a.ts", diff: expect.stringContaining("+for (i < n)") }])

    const handedBack = track(controller.listen())
    controller.handBack("finish it")
    await advance(10)
    expect(handedBack.value!.events).toEqual([{ kind: "turn", to: "agent", message: "finish it" }])
    expect(handedBack.value!.turn).toBe("agent")
  })
})

describe("cancellation", () => {
  it("releases a blocked call without consuming the report", async () => {
    const { controller } = setup({ "a.ts": "" })
    await controller.start()
    await controller.step([{ move: { file: "a.ts" } }])
    await advance(500)
    const abort = new AbortController()
    const cancelled = track(controller.listen(abort.signal))
    await advance(10)
    abort.abort()
    await advance(10)
    expect(cancelled.error).toMatchObject({ code: "cancelled" })

    // The next call isn't stuck behind the cancelled one, and gets the report.
    controller.userMessage("hello")
    const report = await until(controller.listen())
    expect(report.batches).toEqual([{ id: 1, status: "completed", played: 1 }])
    expect(report.events).toEqual([{ kind: "message", text: "hello" }])
  })

  it("keeps a cancelled step's batch queued and reports it later", async () => {
    const { editor, controller } = setup({ "a.ts": "" })
    await controller.start()
    await controller.step([{ move: { file: "a.ts" } }, { type: "ab" }])
    const abort = new AbortController()
    const second = track(controller.step([{ type: "c" }], abort.signal))
    await advance(10)
    expect(second.done).toBe(false)
    abort.abort()
    await advance(10)
    expect(second.error).toMatchObject({ code: "cancelled" })

    await advance(1000)
    expect(editor.text("a.ts")).toBe("abc")
    const report = await until(controller.step([]))
    expect(report.batches.map((b) => [b.id, b.status])).toEqual([
      [1, "completed"],
      [2, "completed"],
    ])
  })
})

describe("sessions", () => {
  it("rejects tools outside a session and a second start", async () => {
    const { controller } = setup()
    await expect(controller.step([])).rejects.toMatchObject({ code: "no_session" })
    await controller.start()
    await expect(controller.start()).rejects.toMatchObject({ code: "session_active" })
  })

  it("ends when the programmer ends it, delivering a final report", async () => {
    const { controller } = setup({ "a.ts": "" })
    await controller.start()
    const listening = track(controller.listen())
    controller.endSession()
    await advance(10)
    expect(listening.value!.events).toEqual([{ kind: "end" }])
    await expect(controller.listen()).rejects.toMatchObject({ code: "no_session" })
  })

  it("plays out the queue when the agent ends, then allows a new session", async () => {
    const { editor, panel, controller } = setup({ "a.ts": "" })
    await controller.start("first")
    await controller.step([{ move: { file: "a.ts" } }, { type: "abc" }])
    const final = await until(controller.end("Done."))
    expect(final.batches).toEqual([{ id: 1, status: "completed", played: 2 }])
    expect(editor.text("a.ts")).toBe("abc")
    expect(panel.events).toContainEqual({ type: "session", active: false, reason: "agent", summary: "Done." })
    await expect(controller.listen()).rejects.toMatchObject({ code: "no_session" })

    await controller.start("second")
    expect(controller.isActive).toBe(true)
  })
})

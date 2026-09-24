// The protocol state machine: sessions, the batch queue, playback, and reports.
// See PROTOCOL.md for the rules implemented here.

import type {
  Action,
  Anchor,
  BatchResult,
  Candidate,
  CursorInfo,
  ErrorKind,
  Event,
  FileContent,
  Report,
  Turn,
} from "@ai-pair/protocol"
import { ToolError } from "@ai-pair/protocol"
import { resolveAnchor, resolveSpan, type Resolution } from "./anchors"
import { fileDiff } from "./diff"
import type { AgentState, Change, CursorView, EditorPort, PanelPort } from "./ports"
import { eolOf, isLineStart, position, splitLines } from "./text"
import { Timeline } from "./timeline"
import { planTyping, readingTime, type Cadence, type Reading } from "./typing"

export type Config = {
  maxBlockMs: number
  type: Cadence
  typeFast: Cadence
  reading: Reading
  /** Pause before a move, a selection, or a deletion, so the programmer sees it coming. */
  beatMs: number
  /** During the programmer's turn, how long after their last edit `listen` returns. */
  navigatorIdleMs: number
  random: () => number
}

export const defaultConfig: Config = {
  maxBlockMs: 60_000,
  type: { rate: 15, jitter: 0.3, punctuationPauseMs: 80, newlinePauseMs: 250 },
  typeFast: { rate: 60, jitter: 0.3, punctuationPauseMs: 0, newlinePauseMs: 40 },
  reading: { msPerWord: 180, minMs: 1000, maxMs: 6000 },
  beatMs: 300,
  navigatorIdleMs: 3000,
  random: Math.random,
}

type Batch = {
  id: number
  actions: Action[]
  state: "queued" | "playing" | "done"
  result?: BatchResult
}

/** Like `Event`, but edits get their diff when the report is taken. */
type PendingEvent = Exclude<Event, { kind: "edit" }> | { kind: "edit"; file: string }

type Session = {
  task?: string
  turn: Turn
  /** Batches not yet finished; the head may be playing. */
  queue: Batch[]
  /** Finished batches not yet reported. */
  finished: BatchResult[]
  events: PendingEvent[]
  /** An unreported interruption or failure: new batches are discarded. */
  stale: boolean
  /** Text of each file edited by the programmer, as of the last report. */
  baselines: Map<string, string>
  latest: Map<string, string>
  cursor: { file: string; offset: number } | null
  selection: { start: number; end: number } | null
  point: { file: string; start: number; end: number } | null
  timeline: Timeline
  running: boolean
  reading: boolean
  /** Ended by the programmer; the final report hasn't been delivered yet. */
  ended: boolean
  navigatorReady: boolean
  navigatorTimer?: ReturnType<typeof setTimeout>
}

type Call = {
  kind: "step" | "listen" | "end"
  batch?: Batch
  summary?: string
  timer: ReturnType<typeof setTimeout>
  resolve: (report: Report) => void
  reject: (error: unknown) => void
}

type Outcome =
  | { kind: "ok" }
  | { kind: "interrupted"; typed?: string }
  | { kind: "error"; error: ErrorKind; message: string; candidates?: Candidate[] }

const ok: Outcome = { kind: "ok" }

function fail(error: ErrorKind, message: string): Outcome {
  return { kind: "error", error, message }
}

function failed(r: Resolution & { ok: false }): Outcome {
  return { kind: "error", error: r.kind, message: r.message, candidates: r.candidates }
}

export class Controller {
  private session: Session | null = null
  private call: Call | null = null
  private chain: Promise<unknown> = Promise.resolve()
  private nextBatchId = 1
  private pauseReasons = new Set<string>()
  private speed = 1
  private lastPosted = ""

  constructor(
    private readonly editor: EditorPort,
    private readonly panel: PanelPort,
    private readonly config: Config = defaultConfig,
  ) {}

  // ---- Tools -------------------------------------------------------------

  start(task?: string): Promise<Report> {
    return this.serialize(async () => {
      if (this.session && !this.session.ended) {
        throw new ToolError("session_active", "A pairing session is already active in this window.")
      }
      const s: Session = {
        task,
        turn: "agent",
        queue: [],
        finished: [],
        events: [],
        stale: false,
        baselines: new Map(),
        latest: new Map(),
        cursor: null,
        selection: null,
        point: null,
        timeline: new Timeline(this.pauseReasons.size > 0),
        running: false,
        reading: false,
        ended: false,
        navigatorReady: false,
      }
      this.session = s
      this.lastPosted = ""
      this.panel.post({ type: "session", active: true, task })
      this.render()
      return { batches: [], events: [], turn: s.turn }
    })
  }

  step(actions: Action[]): Promise<Report> {
    return this.serialize(() => {
      const s = this.requireSession()
      const batch: Batch = { id: this.nextBatchId++, actions, state: "queued" }
      if (s.stale || s.ended) {
        this.discard(s, batch)
      } else {
        s.queue.push(batch)
        this.kick(s)
      }
      return this.block("step", { batch })
    })
  }

  listen(): Promise<Report> {
    return this.serialize(() => {
      this.requireSession()
      return this.block("listen", {})
    })
  }

  end(summary?: string): Promise<Report> {
    return this.serialize(() => {
      this.requireSession()
      return this.block("end", { summary })
    })
  }

  read(file: string, fromLine?: number, toLine?: number): Promise<FileContent> {
    this.requireSession()
    const path = this.editor.resolvePath(file)
    return (async () => {
      const lines = splitLines(await this.editor.getText(path))
      const from = Math.max(1, fromLine ?? 1)
      const to = Math.min(lines.length, toLine ?? lines.length)
      return {
        file: this.editor.displayPath(path),
        dirty: await this.editor.isDirty(path),
        lines: lines.slice(from - 1, to).map((text, i) => ({ number: from + i, text })),
      }
    })()
  }

  // ---- Programmer input --------------------------------------------------

  userMessage(text: string): void {
    const s = this.activeSession()
    if (!s) return
    s.events.push({ kind: "message", text })
    this.panel.post({ type: "user", text })
    this.interrupt(s)
    this.update()
  }

  userInterrupt(): void {
    const s = this.activeSession()
    if (!s) return
    s.events.push({ kind: "interrupt" })
    this.panel.post({ type: "interrupt" })
    this.interrupt(s)
    this.update()
  }

  /** A change the programmer made. `changes` are applied in order, each to the result of the previous. */
  userEdit(file: string, before: string, after: string, changes: Change[]): void {
    const s = this.activeSession()
    if (!s) return
    for (const change of changes) this.transformPositions(s, file, change)
    if (!s.baselines.has(file)) {
      s.baselines.set(file, before)
      s.events.push({ kind: "edit", file })
    }
    s.latest.set(file, after)
    if (s.turn === "agent") {
      this.interrupt(s)
    } else {
      clearTimeout(s.navigatorTimer)
      s.navigatorTimer = setTimeout(() => {
        s.navigatorReady = true
        this.pump()
      }, this.config.navigatorIdleMs)
    }
    this.update()
  }

  takeTurn(): void {
    const s = this.activeSession()
    if (!s || s.turn === "user") return
    s.turn = "user"
    s.events.push({ kind: "turn", to: "user" })
    this.panel.post({ type: "turn", to: "user" })
    this.interrupt(s)
    this.update()
  }

  handBack(message?: string): void {
    const s = this.activeSession()
    if (!s || s.turn === "agent") return
    s.turn = "agent"
    clearTimeout(s.navigatorTimer)
    s.events.push(message ? { kind: "turn", to: "agent", message } : { kind: "turn", to: "agent" })
    this.panel.post({ type: "turn", to: "agent", message })
    this.interrupt(s)
    this.update()
  }

  endSession(): void {
    const s = this.activeSession()
    if (!s) return
    s.ended = true
    s.events.push({ kind: "end" })
    this.interrupt(s)
    this.panel.post({ type: "session", active: false, reason: "user" })
    this.update()
  }

  /** The agent is gone (the relay disconnected). */
  disconnect(): void {
    const s = this.session
    if (this.call) {
      clearTimeout(this.call.timer)
      this.call.reject(new ToolError("no_session", "Disconnected."))
      this.call = null
    }
    if (!s) return
    this.close(s)
    if (!s.ended) this.panel.post({ type: "session", active: false, reason: "disconnected" })
  }

  pause(reason = "user"): void {
    this.pauseReasons.add(reason)
    this.session?.timeline.pause()
    this.render()
  }

  /** Removes one pause reason, or all of them. Playback continues when none are left. */
  resume(reason?: string): void {
    if (this.pauseReasons.size === 0) return
    if (reason === undefined) this.pauseReasons.clear()
    else this.pauseReasons.delete(reason)
    if (this.pauseReasons.size > 0) return
    const s = this.session
    if (s) {
      const cursor = this.cursorView(s)
      if (cursor && s.turn === "agent") this.editor.reveal(cursor)
      s.timeline.resume()
    }
    this.render()
  }

  setSpeed(speed: number): void {
    this.speed = speed
  }

  get isActive(): boolean {
    return this.activeSession() !== null
  }

  // ---- Calls and reports -------------------------------------------------

  private serialize<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn)
    this.chain = run.catch(() => {})
    return run
  }

  private requireSession(): Session {
    if (!this.session) {
      throw new ToolError("no_session", "No pairing session is active. Call `start` to begin one.")
    }
    return this.session
  }

  private activeSession(): Session | null {
    return this.session && !this.session.ended ? this.session : null
  }

  private block(kind: Call["kind"], opts: { batch?: Batch; summary?: string }): Promise<Report> {
    return new Promise((resolve, reject) => {
      this.call = {
        kind,
        ...opts,
        resolve,
        reject,
        timer: setTimeout(() => this.finishCall(true), this.config.maxBlockMs),
      }
      this.update()
    })
  }

  private ready(call: Call, s: Session): boolean {
    if (s.ended) return true
    // An interrupted batch finishes promptly; wait for it, so the report says what was typed.
    if (s.queue[0]?.state === "playing" && s.timeline.isInterrupted) return false
    switch (call.kind) {
      case "step":
        return call.batch!.state === "done" || s.queue[0] === call.batch
      case "end":
        return s.queue.length === 0
      case "listen":
        if (s.finished.some((r) => r.status !== "completed")) return true
        if (s.queue.length > 0) return false
        if (s.turn === "agent") return s.events.length > 0
        return s.events.some((e) => e.kind !== "edit") || (s.navigatorReady && s.events.length > 0)
    }
  }

  private pump(): void {
    const call = this.call
    const s = this.session
    if (call && s && this.ready(call, s)) this.finishCall(false)
  }

  private finishCall(timedOut: boolean): void {
    const call = this.call
    if (!call) return
    this.call = null
    clearTimeout(call.timer)
    const s = this.session
    if (!s) {
      call.reject(new ToolError("no_session", "The session has ended."))
      return
    }
    const closing = s.ended || call.kind === "end"
    const report = this.snapshot(s, call, timedOut && !closing)
    if (closing) {
      this.close(s)
      if (call.kind === "end" && !s.ended) {
        this.panel.post({ type: "session", active: false, reason: "agent", summary: call.summary })
      }
    }
    this.render()
    void this.cursorInfo(s).then(
      (cursor) => call.resolve(cursor ? { ...report, cursor } : report),
      () => call.resolve(report),
    )
  }

  private snapshot(s: Session, call: Call, waiting: boolean): Report {
    const batches = s.finished.sort((a, b) => a.id - b.id)
    const events: Event[] = []
    for (const e of s.events) {
      if (e.kind !== "edit") {
        events.push(e)
        continue
      }
      const before = s.baselines.get(e.file) ?? ""
      const after = s.latest.get(e.file) ?? before
      if (before === after) continue
      const file = this.editor.displayPath(e.file)
      events.push({ kind: "edit", file, diff: fileDiff(file, before, after) })
    }
    s.finished = []
    s.events = []
    s.baselines = new Map()
    s.latest = new Map()
    s.stale = false
    s.navigatorReady = false

    const report: Report = { batches, events, turn: s.turn }
    if (call.batch) {
      const b = call.batch
      report.submitted = { id: b.id, status: b.state === "done" ? b.result!.status : b.state }
    }
    if (waiting) report.waiting = true
    return report
  }

  private async cursorInfo(s: Session): Promise<CursorInfo | undefined> {
    if (!s.cursor) return undefined
    const text = await this.editor.getText(s.cursor.file)
    const info: CursorInfo = { file: this.editor.displayPath(s.cursor.file), ...position(text, s.cursor.offset) }
    if (s.selection) {
      info.selection = { from: position(text, s.selection.start), to: position(text, s.selection.end) }
    }
    return info
  }

  private close(s: Session): void {
    if (this.session === s) this.session = null
    s.timeline.interrupt()
    clearTimeout(s.navigatorTimer)
    this.editor.renderPoint(null)
    this.render()
  }

  // ---- Queue ---------------------------------------------------------------

  private discard(s: Session, batch: Batch): void {
    batch.state = "done"
    batch.result = { id: batch.id, status: "discarded", played: 0, unplayed: batch.actions }
    s.finished.push(batch.result)
  }

  /** Stops playback and discards everything queued behind it. */
  private interrupt(s: Session): void {
    s.stale = true
    for (const b of s.queue) if (b.state === "queued") this.discard(s, b)
    s.queue = s.queue.filter((b) => b.state !== "done")
    s.timeline.interrupt()
  }

  private update(): void {
    this.render()
    this.pump()
  }

  // ---- Playback ------------------------------------------------------------

  private kick(s: Session): void {
    if (!s.running) void this.run(s)
  }

  private async run(s: Session): Promise<void> {
    s.running = true
    try {
      while (this.session === s) {
        const batch = s.queue[0]
        if (!batch) break
        this.startHead(s)
        this.render()
        const touched = new Set<string>()
        const result = await this.play(s, batch, touched)
        for (const file of touched) {
          try {
            await this.editor.save(file)
          } catch {
            // Saving is best effort; the buffer is still the truth.
          }
        }
        if (this.session !== s) break
        batch.state = "done"
        batch.result = result
        s.queue = s.queue.filter((b) => b !== batch)
        s.finished.push(result)
        if (result.status !== "completed") this.interrupt(s)
        // Mark the next batch as playing before reporting, so the report says so.
        this.startHead(s)
        this.update()
      }
    } finally {
      s.running = false
    }
  }

  private startHead(s: Session): void {
    const head = s.queue[0]
    if (head?.state !== "queued") return
    head.state = "playing"
    s.timeline.reset()
  }

  private async play(s: Session, batch: Batch, touched: Set<string>): Promise<BatchResult> {
    const { id, actions } = batch
    for (let i = 0; i < actions.length; i++) {
      if (s.timeline.isInterrupted) return this.interruptedResult(batch, i)
      let outcome: Outcome
      try {
        outcome = await this.perform(s, actions[i]!, touched)
      } catch (e) {
        outcome = fail("invalid_action", e instanceof Error ? e.message : String(e))
      }
      if (outcome.kind === "interrupted") return this.interruptedResult(batch, i, outcome.typed)
      if (outcome.kind === "error") {
        return {
          id,
          status: "failed",
          played: i,
          unplayed: actions.slice(i),
          error: { index: i, kind: outcome.error, message: outcome.message, candidates: outcome.candidates },
        }
      }
    }
    return { id, status: "completed", played: actions.length }
  }

  private interruptedResult(batch: Batch, index: number, typed?: string): BatchResult {
    const { id, actions } = batch
    if (typed) {
      return { id, status: "interrupted", played: index, partial: { index, typed }, unplayed: actions.slice(index + 1) }
    }
    if (index === 0) return { id, status: "discarded", played: 0, unplayed: actions }
    return { id, status: "interrupted", played: index, unplayed: actions.slice(index) }
  }

  private delay(s: Session, ms: number): Promise<boolean> {
    return s.timeline.sleep(ms / this.speed)
  }

  private async perform(s: Session, action: Action, touched: Set<string>): Promise<Outcome> {
    if (s.turn === "user" && !("say" in action) && !("point" in action)) {
      return fail("not_your_turn", "During the programmer's turn, only `say` and `point` are allowed.")
    }

    if ("say" in action) {
      this.panel.post({ type: "say", text: action.say })
      const ms = readingTime(action.say, this.config.reading) / this.speed
      s.reading = true
      this.panel.post({ type: "reading", ms })
      this.render()
      await s.timeline.sleep(ms)
      s.reading = false
      this.render()
      return ok
    }

    if ("move" in action) {
      const m = action.move
      const file = m.file !== undefined ? this.editor.resolvePath(m.file) : s.cursor?.file
      if (!file) return fail("no_file", "The agent cursor isn't in a file yet; give `file`.")
      if (!(await this.delay(s, this.config.beatMs))) return { kind: "interrupted" }
      await this.editor.show(file)
      const text = await this.editor.getText(file)
      let offset: number
      if (m.position === "file_end") offset = text.length
      else if (m.position === "file_start" || m.text === undefined) offset = 0
      else {
        const from = s.cursor?.file === file ? s.cursor.offset : 0
        const r = resolveAnchor(text, m as Anchor, from)
        if (!r.ok) return failed(r)
        offset = m.at === "start" ? r.range.start : r.range.end
      }
      s.cursor = { file, offset }
      s.selection = null
      this.render()
      return ok
    }

    if ("select" in action) {
      if (!s.cursor) return fail("no_file", "The agent cursor isn't in a file yet; `move` first.")
      if (!(await this.delay(s, this.config.beatMs))) return { kind: "interrupted" }
      await this.editor.show(s.cursor.file)
      const r = resolveSpan(await this.editor.getText(s.cursor.file), action.select, s.cursor.offset)
      if (!r.ok) return failed(r)
      s.selection = r.range
      s.cursor.offset = r.range.end
      this.render()
      return ok
    }

    if ("type" in action || "type_fast" in action) {
      const fast = "type_fast" in action
      return this.type(s, fast ? action.type_fast : action.type, fast, touched)
    }

    if ("delete" in action) {
      if (!s.cursor || !s.selection) return fail("no_selection", "Nothing is selected; `select` first.")
      if (!(await this.delay(s, this.config.beatMs))) return { kind: "interrupted" }
      const { file } = s.cursor
      const { start, end } = s.selection
      await this.editor.show(file)
      this.clearPoint(s)
      s.cursor.offset = start
      s.selection = null
      touched.add(file)
      await this.editor.edit(file, start, end - start, "", { undoStopBefore: true, undoStopAfter: true })
      this.render()
      return ok
    }

    if ("point" in action) {
      const p = action.point
      const file = p.file !== undefined ? this.editor.resolvePath(p.file) : s.cursor?.file
      if (!file) return fail("no_file", "The agent cursor isn't in a file yet; give `file`.")
      if (s.turn === "agent") await this.editor.show(file)
      const text = await this.editor.getText(file)
      const r = resolveSpan(text, p, s.cursor?.file === file ? s.cursor.offset : 0)
      if (!r.ok) return failed(r)
      s.point = { file, ...r.range }
      this.editor.renderPoint(s.point)
      this.panel.post({ type: "point", file: this.editor.displayPath(file), line: position(text, r.range.start).line })
      return ok
    }

    return fail("invalid_action", `Unknown action: ${JSON.stringify(action)}`)
  }

  private async type(s: Session, text: string, fast: boolean, touched: Set<string>): Promise<Outcome> {
    if (!s.cursor) return fail("no_file", "The agent cursor isn't in a file yet; `move` first.")
    const cursor = s.cursor
    await this.editor.show(cursor.file)
    this.clearPoint(s)

    const doc = await this.editor.getText(cursor.file)
    const eol = eolOf(doc)
    const insertAt = s.selection ? s.selection.start : cursor.offset
    const cadence = fast ? this.config.typeFast : this.config.type
    const chunks = planTyping(text, cadence, isLineStart(doc, insertAt), this.config.random)

    if (chunks.length === 0 && s.selection) chunks.push({ text: "", delay: 0 })
    let typed = ""
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i]!
      if (!(await this.delay(s, chunk.delay))) return { kind: "interrupted", typed }
      const insert = eol === "\n" ? chunk.text : chunk.text.replaceAll("\n", eol)
      const start = s.selection ? s.selection.start : cursor.offset
      const deleteLength = s.selection ? s.selection.end - s.selection.start : 0
      // Move the cursor before awaiting, so programmer edits arriving meanwhile transform the right position.
      cursor.offset = start + insert.length
      s.selection = null
      touched.add(cursor.file)
      await this.editor.edit(cursor.file, start, deleteLength, insert, {
        undoStopBefore: i === 0,
        undoStopAfter: i === chunks.length - 1,
      })
      typed += chunk.text
      this.render()
    }
    return ok
  }

  private clearPoint(s: Session): void {
    if (!s.point) return
    s.point = null
    this.editor.renderPoint(null)
  }

  private transformPositions(s: Session, file: string, change: Change): void {
    const map = (pos: number): number => {
      if (pos <= change.offset) return pos
      if (pos >= change.offset + change.deleteLength) return pos + change.text.length - change.deleteLength
      return change.offset + change.text.length
    }
    if (s.cursor?.file === file) s.cursor.offset = map(s.cursor.offset)
    if (s.cursor?.file === file && s.selection) {
      s.selection = { start: map(s.selection.start), end: map(s.selection.end) }
    }
    if (s.point?.file === file) s.point = { file, start: map(s.point.start), end: map(s.point.end) }
  }

  // ---- Rendering -----------------------------------------------------------

  private cursorView(s: Session): CursorView | null {
    if (!s.cursor) return null
    return s.selection ? { ...s.cursor, selection: s.selection } : { ...s.cursor }
  }

  private state(): AgentState {
    const s = this.session
    if (!s || s.turn === "user") return "navigator"
    if (this.pauseReasons.size > 0) return "paused"
    if (s.queue.length > 0) return s.reading ? "read" : "typing"
    return this.call?.kind === "listen" ? "listening" : "thinking"
  }

  private render(): void {
    const s = this.activeSession()
    const state = this.state()
    this.editor.renderCursor(s ? this.cursorView(s) : null, state)
    if (!s) return
    const paused = this.pauseReasons.size > 0
    const key = `${state}/${s.turn}/${paused}`
    if (key === this.lastPosted) return
    this.lastPosted = key
    this.panel.post({ type: "state", state, turn: s.turn, paused })
  }
}

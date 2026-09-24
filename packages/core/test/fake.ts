import { vi } from "vitest"
import { Controller, defaultConfig, type Config } from "../src/controller"
import type { AgentState, CursorView, EditOptions, EditorPort, PanelEvent, PanelPort } from "../src/ports"

const ROOT = "/project/"

export class FakeEditor implements EditorPort {
  files = new Map<string, string>()
  dirty = new Set<string>()
  saved: string[] = []
  edits: { file: string; offset: number; deleteLength: number; text: string; options: EditOptions }[] = []
  shown: string[] = []
  cursor: CursorView | null = null
  state: AgentState | null = null
  point: { file: string; start: number; end: number } | null = null
  controller!: Controller

  resolvePath(file: string): string {
    return file.startsWith("/") ? file : ROOT + file
  }
  displayPath(file: string): string {
    return file.startsWith(ROOT) ? file.slice(ROOT.length) : file
  }
  async getText(file: string): Promise<string> {
    const text = this.files.get(file)
    if (text === undefined) throw new Error(`No such file: ${file}`)
    return text
  }
  async isDirty(file: string): Promise<boolean> {
    return this.dirty.has(file)
  }
  async show(file: string): Promise<void> {
    if (!this.files.has(file)) this.files.set(file, "")
    if (this.shown.at(-1) !== file) this.shown.push(file)
  }
  async edit(file: string, offset: number, deleteLength: number, text: string, options: EditOptions): Promise<void> {
    const old = await this.getText(file)
    this.files.set(file, old.slice(0, offset) + text + old.slice(offset + deleteLength))
    this.dirty.add(file)
    this.edits.push({ file, offset, deleteLength, text, options })
  }
  async save(file: string): Promise<void> {
    this.dirty.delete(file)
    this.saved.push(file)
  }
  renderCursor(cursor: CursorView | null, state: AgentState): void {
    this.cursor = cursor
    this.state = state
  }
  renderPoint(point: { file: string; start: number; end: number } | null): void {
    this.point = point
  }
  reveal(): void {}

  /** The programmer types into a file. */
  userEdit(name: string, offset: number, deleteLength: number, text: string): void {
    const file = this.resolvePath(name)
    const before = this.files.get(file) ?? ""
    const after = before.slice(0, offset) + text + before.slice(offset + deleteLength)
    this.files.set(file, after)
    this.controller.userEdit(file, before, after, [{ offset, deleteLength, text }])
  }

  text(name: string): string {
    return this.files.get(this.resolvePath(name)) ?? ""
  }
}

export class FakePanel implements PanelPort {
  events: PanelEvent[] = []
  post(event: PanelEvent): void {
    this.events.push(event)
  }
  says(): string[] {
    return this.events.flatMap((e) => (e.type === "say" ? [e.text] : []))
  }
}

/** Deterministic timing: no jitter, round numbers. */
export const testConfig: Config = {
  ...defaultConfig,
  type: { rate: 10, jitter: 0.3, punctuationPauseMs: 0, newlinePauseMs: 0 },
  typeFast: { rate: 100, jitter: 0.3, punctuationPauseMs: 0, newlinePauseMs: 0 },
  reading: { msPerWord: 100, minMs: 500, maxMs: 2000 },
  beatMs: 100,
  navigatorIdleMs: 1000,
  random: () => 0.5,
}

export function setup(files: Record<string, string> = {}, config: Partial<Config> = {}) {
  const editor = new FakeEditor()
  const panel = new FakePanel()
  for (const [name, text] of Object.entries(files)) editor.files.set(editor.resolvePath(name), text)
  const controller = new Controller(editor, panel, { ...testConfig, ...config })
  editor.controller = controller
  return { editor, panel, controller }
}

/** Tracks a promise so tests can check whether it has settled yet. */
export function track<T>(promise: Promise<T>) {
  const t = { done: false, value: undefined as T | undefined, error: undefined as unknown }
  promise.then(
    (v) => {
      t.done = true
      t.value = v
    },
    (e) => {
      t.done = true
      t.error = e
    },
  )
  return t
}

/** Advances fake time until the promise settles. */
export async function until<T>(promise: Promise<T>, maxMs = 120_000): Promise<T> {
  const t = track(promise)
  for (let elapsed = 0; !t.done && elapsed < maxMs; elapsed += 10) {
    await vi.advanceTimersByTimeAsync(10)
  }
  if (!t.done) throw new Error(`Still pending after ${maxMs} ms`)
  if (t.error !== undefined) throw t.error
  return t.value as T
}

export async function advance(ms: number): Promise<void> {
  await vi.advanceTimersByTimeAsync(ms)
}

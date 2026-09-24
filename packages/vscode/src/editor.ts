// The EditorPort for VS Code: documents, edits, the agent cursor, follow mode.

import * as path from "node:path"
import * as vscode from "vscode"
import type { AgentState, Change, Controller, CursorView, EditOptions, EditorPort } from "@ai-pair/core"

type OwnEdit = { offset: number; deleteLength: number; text: string }

/** States in which the programmer's view follows the agent cursor. */
const FOLLOWING: ReadonlySet<AgentState> = new Set(["typing", "read", "thinking", "listening"])

/** View changes within this long after our own navigation are ours, not the programmer's. */
const SELF_NAV_MS = 400

function cursorDecoration(color: string, style: string, opacity: number) {
  return vscode.window.createTextEditorDecorationType({
    before: {
      contentText: "\u200b",
      textDecoration: `none; position: relative; border-left: 2px ${style} ${color}; margin-left: -1px; margin-right: -1px; opacity: ${opacity};`,
    },
    rangeBehavior: vscode.DecorationRangeBehavior.ClosedClosed,
  })
}

function labelDecoration(text: string, color: string, opacity: number) {
  return vscode.window.createTextEditorDecorationType({
    before: {
      contentText: text,
      textDecoration: `none; position: absolute; transform: translateY(-105%); z-index: 10; pointer-events: none; padding: 0 4px; border-radius: 3px; font-size: 0.75em; line-height: 1.35; white-space: nowrap; background-color: ${color}; color: #1b1b1b; opacity: ${opacity};`,
    },
  })
}

const CURSOR = "var(--vscode-aiPair-cursor)"
const READ = "var(--vscode-aiPair-cursorRead)"

export class VsCodeEditor implements EditorPort, vscode.Disposable {
  controller?: Controller
  private readonly mirror = new Map<string, string>()
  private readonly own = new Map<string, OwnEdit[]>()
  private cursor: CursorView | null = null
  private state: AgentState = "thinking"
  private point: { file: string; start: number; end: number } | null = null
  private pulse?: ReturnType<typeof setInterval>
  private pulseOn = true
  private selfNavUntil = 0
  private readonly disposables: vscode.Disposable[] = []
  private readonly cursorTypes: Record<string, vscode.TextEditorDecorationType>
  private labelTypes: Record<string, vscode.TextEditorDecorationType> = {}
  private readonly selectionType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("aiPair.selectionBackground"),
  })
  private readonly pointType = vscode.window.createTextEditorDecorationType({
    backgroundColor: new vscode.ThemeColor("aiPair.pointBackground"),
    border: "1px solid",
    borderColor: new vscode.ThemeColor("aiPair.pointBorder"),
    borderRadius: "2px",
  })

  constructor(
    private readonly root: string,
    agentName: string,
  ) {
    this.cursorTypes = {
      typing: cursorDecoration(CURSOR, "solid", 1),
      read: cursorDecoration(READ, "solid", 1),
      readDim: cursorDecoration(CURSOR, "solid", 0.6),
      thinking: cursorDecoration(CURSOR, "solid", 0.45),
      paused: cursorDecoration(CURSOR, "dashed", 0.6),
      listening: cursorDecoration(CURSOR, "dotted", 0.8),
      navigator: cursorDecoration(CURSOR, "dotted", 0.8),
    }
    this.setAgentName(agentName)
    for (const doc of vscode.workspace.textDocuments) this.track(doc)
    this.disposables.push(
      vscode.workspace.onDidOpenTextDocument((doc) => this.track(doc)),
      vscode.workspace.onDidCloseTextDocument((doc) => this.mirror.delete(doc.uri.fsPath)),
      vscode.workspace.onDidChangeTextDocument((e) => this.onChange(e)),
      vscode.window.onDidChangeActiveTextEditor((e) => this.onActiveEditor(e)),
      vscode.window.onDidChangeTextEditorVisibleRanges((e) => this.onScroll(e)),
      vscode.window.onDidChangeVisibleTextEditors(() => this.redraw()),
    )
  }

  setAgentName(name: string): void {
    for (const t of Object.values(this.labelTypes)) t.dispose()
    this.labelTypes = {
      typing: labelDecoration(name, CURSOR, 1),
      read: labelDecoration(name, READ, 1),
      readDim: labelDecoration(name, CURSOR, 1),
      thinking: labelDecoration(name, CURSOR, 0.6),
      paused: labelDecoration(`${name} · paused`, CURSOR, 0.8),
      listening: labelDecoration(`${name} · listening`, CURSOR, 0.8),
      navigator: labelDecoration(`${name} · your turn`, CURSOR, 0.8),
    }
    this.redraw()
  }

  // ---- EditorPort ----------------------------------------------------------

  resolvePath(file: string): string {
    return path.resolve(this.root, file)
  }

  displayPath(file: string): string {
    return this.inWorkspace(file) ? path.relative(this.root, file) : file
  }

  async getText(file: string): Promise<string> {
    return (await this.document(file)).getText()
  }

  async isDirty(file: string): Promise<boolean> {
    return this.openDocument(file)?.isDirty ?? false
  }

  async show(file: string): Promise<void> {
    const uri = vscode.Uri.file(file)
    try {
      await vscode.workspace.fs.stat(uri)
    } catch {
      await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(file)))
      await vscode.workspace.fs.writeFile(uri, new Uint8Array())
    }
    if (this.visibleEditor(file)) return
    this.selfNav()
    const doc = await vscode.workspace.openTextDocument(uri)
    await vscode.window.showTextDocument(doc, {
      preview: false,
      preserveFocus: true,
      viewColumn: vscode.window.activeTextEditor?.viewColumn,
    })
  }

  async edit(file: string, offset: number, deleteLength: number, text: string, options: EditOptions): Promise<void> {
    const editor = this.visibleEditor(file)
    const entry: OwnEdit = { offset, deleteLength, text }
    const pending = this.own.get(file) ?? []
    this.own.set(file, pending)
    pending.push(entry)
    try {
      if (editor) {
        const doc = editor.document
        const range = new vscode.Range(doc.positionAt(offset), doc.positionAt(offset + deleteLength))
        if (!(await editor.edit((b) => b.replace(range, text), options))) throw new Error("The edit was rejected.")
      } else {
        // Not visible (e.g. the programmer looked away): no control over undo stops.
        const doc = await this.document(file)
        const range = new vscode.Range(doc.positionAt(offset), doc.positionAt(offset + deleteLength))
        const edit = new vscode.WorkspaceEdit()
        edit.replace(doc.uri, range, text)
        if (!(await vscode.workspace.applyEdit(edit))) throw new Error("The edit was rejected.")
      }
    } finally {
      const i = pending.indexOf(entry)
      if (i !== -1) pending.splice(i, 1)
    }
  }

  async save(file: string): Promise<void> {
    await this.openDocument(file)?.save()
  }

  renderCursor(cursor: CursorView | null, state: AgentState): void {
    this.cursor = cursor
    if (state !== this.state) {
      this.state = state
      this.updatePulse()
    }
    this.redraw()
    if (cursor && FOLLOWING.has(state)) this.follow(cursor)
  }

  renderPoint(point: { file: string; start: number; end: number } | null): void {
    this.point = point
    this.redraw()
  }

  reveal(cursor: CursorView): void {
    void this.show(cursor.file).then(() => this.follow(cursor, true))
  }

  // ---- Programmer activity -------------------------------------------------

  private track(doc: vscode.TextDocument): void {
    if (doc.uri.scheme === "file") this.mirror.set(doc.uri.fsPath, doc.getText())
  }

  private onChange(e: vscode.TextDocumentChangeEvent): void {
    const doc = e.document
    if (doc.uri.scheme !== "file" || e.contentChanges.length === 0) return
    const file = doc.uri.fsPath
    const before = this.mirror.get(file)
    const after = doc.getText()
    this.mirror.set(file, after)

    // Applied from the highest offset down, each change leaves the offsets below it valid.
    const changes: Change[] = [...e.contentChanges]
      .sort((a, b) => b.rangeOffset - a.rangeOffset)
      .map((c) => ({ offset: c.rangeOffset, deleteLength: c.rangeLength, text: c.text }))

    const pending = this.own.get(file)
    const own = pending?.[0]
    const change = changes[0]!
    if (
      own &&
      changes.length === 1 &&
      change.offset === own.offset &&
      change.deleteLength === own.deleteLength &&
      change.text === own.text
    ) {
      pending!.shift()
      return
    }

    if (before === undefined || !this.inWorkspace(file)) return
    this.controller?.userEdit(file, before, after, changes)
  }

  private onActiveEditor(editor: vscode.TextEditor | undefined): void {
    if (!editor || Date.now() < this.selfNavUntil || !this.cursor || !FOLLOWING.has(this.state)) return
    if (editor.document.uri.fsPath !== this.cursor.file) this.controller?.pause("away")
  }

  private onScroll(e: vscode.TextEditorVisibleRangesChangeEvent): void {
    if (Date.now() < this.selfNavUntil || !this.cursor || !FOLLOWING.has(this.state)) return
    if (e.textEditor.document.uri.fsPath !== this.cursor.file) return
    const line = e.textEditor.document.positionAt(this.cursor.offset).line
    const visible = e.visibleRanges.some((r) => r.start.line <= line && line <= r.end.line)
    if (!visible) this.controller?.pause("away")
  }

  // ---- Rendering -----------------------------------------------------------

  /** Keeps the agent cursor in the upper part of the viewport, scrolling only when it leaves a band. */
  private follow(cursor: CursorView, force = false): void {
    const editor = this.visibleEditor(cursor.file)
    const visible = editor?.visibleRanges[0]
    if (!editor || !visible) return
    const line = editor.document.positionAt(cursor.offset).line
    const height = Math.max(1, visible.end.line - visible.start.line)
    const top = visible.start.line + Math.floor(height * 0.1)
    const bottom = visible.start.line + Math.floor(height * 0.6)
    // At the top of a file the cursor can't sit lower in the viewport, and that's fine.
    const inBand = line <= bottom && (line >= top || visible.start.line === 0)
    if (!force && inBand) return
    const target = Math.max(0, line - Math.floor(height / 3))
    this.selfNav()
    editor.revealRange(new vscode.Range(target, 0, target, 0), vscode.TextEditorRevealType.AtTop)
  }

  private redraw(): void {
    const cursorKey = this.state === "read" ? (this.pulseOn ? "read" : "readDim") : this.state
    for (const editor of vscode.window.visibleTextEditors) {
      const file = editor.document.uri.fsPath
      const doc = editor.document
      const here = this.cursor && this.cursor.file === file ? this.cursor : null
      const at = here ? [new vscode.Range(doc.positionAt(here.offset), doc.positionAt(here.offset))] : []
      for (const [key, type] of Object.entries(this.cursorTypes)) editor.setDecorations(type, key === cursorKey ? at : [])
      for (const [key, type] of Object.entries(this.labelTypes)) editor.setDecorations(type, key === cursorKey ? at : [])
      const sel = here?.selection
      editor.setDecorations(
        this.selectionType,
        sel ? [new vscode.Range(doc.positionAt(sel.start), doc.positionAt(sel.end))] : [],
      )
      const point = this.point && this.point.file === file ? this.point : null
      editor.setDecorations(
        this.pointType,
        point ? [new vscode.Range(doc.positionAt(point.start), doc.positionAt(point.end))] : [],
      )
    }
  }

  private updatePulse(): void {
    clearInterval(this.pulse)
    this.pulse = undefined
    this.pulseOn = true
    if (this.state !== "read") return
    this.pulse = setInterval(() => {
      this.pulseOn = !this.pulseOn
      this.redraw()
    }, 450)
  }

  // ---- Helpers -------------------------------------------------------------

  private selfNav(): void {
    this.selfNavUntil = Date.now() + SELF_NAV_MS
  }

  private inWorkspace(file: string): boolean {
    return !path.relative(this.root, file).startsWith("..")
  }

  private openDocument(file: string): vscode.TextDocument | undefined {
    return vscode.workspace.textDocuments.find((d) => d.uri.fsPath === file)
  }

  private async document(file: string): Promise<vscode.TextDocument> {
    return this.openDocument(file) ?? (await vscode.workspace.openTextDocument(vscode.Uri.file(file)))
  }

  private visibleEditor(file: string): vscode.TextEditor | undefined {
    return vscode.window.visibleTextEditors.find((e) => e.document.uri.fsPath === file)
  }

  dispose(): void {
    clearInterval(this.pulse)
    for (const d of this.disposables) d.dispose()
    for (const t of [...Object.values(this.cursorTypes), ...Object.values(this.labelTypes)]) t.dispose()
    this.selectionType.dispose()
    this.pointType.dispose()
  }
}

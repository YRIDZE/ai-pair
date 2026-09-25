// The narration panel: a webview view in the secondary side bar. See "Narration panel" in DESIGN.md.

import * as vscode from "vscode"
import type { Controller, PanelEvent, PanelPort, Ref, SharedSelection } from "@ai-pair/core"
import { panelHtml } from "./panelHtml"

/** Messages from the webview. */
type FromPanel =
  | { type: "ready" }
  | { type: "reply"; text: string; attach?: boolean }
  | { type: "draft"; empty: boolean }
  | { type: "pause" }
  | { type: "resume" }
  | { type: "interrupt" }
  | { type: "turn"; message?: string; attach?: boolean }
  | { type: "end" }
  | { type: "open"; file: string; line: number }
  | { type: "speed"; value: number }
  | { type: "runDecision"; id: number; run: boolean; remember?: boolean }

const MAX_LOG = 400

export class NarrationPanel implements PanelPort, vscode.WebviewViewProvider {
  static readonly viewId = "aiPair.narration"
  controller?: Controller
  private view?: vscode.WebviewView
  /** Everything posted so far, replayed when the view is (re)created. */
  private readonly log: PanelEvent[] = []

  constructor(
    private readonly resolvePath: (file: string) => string,
    private readonly speed: { get: () => number; set: (value: number) => void },
    private readonly selection: { current: () => SharedSelection | undefined; ref: () => Ref | undefined },
  ) {}

  /** The programmer's selection changed. Not logged: only the current one matters. */
  showSelection(ref: Ref | undefined): void {
    void this.view?.webview.postMessage({ type: "selection", ref })
  }

  /** The speed setting changed. Not logged: only the current value matters. */
  showSpeed(value: number): void {
    void this.view?.webview.postMessage({ type: "speed", value })
  }

  post(event: PanelEvent): void {
    this.log.push(event)
    if (this.log.length > MAX_LOG) this.log.splice(0, this.log.length - MAX_LOG)
    void this.view?.webview.postMessage(event)
    if (event.type === "session") {
      void vscode.commands.executeCommand("setContext", "aiPair.active", event.active)
      if (event.active) this.reveal()
    }
  }

  focusReply(): void {
    this.reveal(false)
    void this.view?.webview.postMessage({ type: "focusReply" })
  }

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view
    view.webview.options = { enableScripts: true }
    view.webview.html = panelHtml(view.webview.cspSource)
    view.webview.onDidReceiveMessage((m: FromPanel) => this.receive(m))
    view.onDidDispose(() => {
      if (this.view === view) this.view = undefined
    })
  }

  private reveal(preserveFocus = true): void {
    if (this.view) this.view.show(preserveFocus)
    else void vscode.commands.executeCommand(`${NarrationPanel.viewId}.focus`)
  }

  private receive(m: FromPanel): void {
    const c = this.controller
    switch (m.type) {
      case "ready":
        void this.view?.webview.postMessage({ type: "replay", events: this.log })
        this.showSpeed(this.speed.get())
        this.showSelection(this.selection.ref())
        return
      case "speed":
        this.speed.set(m.value)
        return
      case "reply":
        // Replying means "go on with this", so any pause ends.
        c?.resume()
        c?.userMessage(m.text, m.attach ? this.selection.current() : undefined)
        return
      case "draft":
        // Typing a reply pauses playback, the way a pair stops when you start talking.
        if (m.empty) c?.resume("reply")
        else c?.pause("reply")
        return
      case "pause":
        c?.pause()
        return
      case "resume":
        c?.resume()
        return
      case "interrupt":
        c?.userInterrupt()
        return
      case "turn":
        c?.resume()
        if (c?.turn === "user") c.handBack(m.message, m.attach ? this.selection.current() : undefined)
        else c?.takeTurn()
        return
      case "end":
        c?.endSession()
        return
      case "runDecision":
        c?.decideRun(m.id, m.run, m.remember)
        return
      case "open": {
        const uri = vscode.Uri.file(this.resolvePath(m.file))
        const position = new vscode.Position(Math.max(0, m.line - 1), 0)
        void vscode.window.showTextDocument(uri, { selection: new vscode.Range(position, position) })
        return
      }
    }
  }
}

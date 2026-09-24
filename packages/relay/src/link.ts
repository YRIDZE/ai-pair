// Finding the right editor window and talking to it. See "Discovery and connection" in ARCHITECTURE.md.

import * as fs from "node:fs"
import * as path from "node:path"
import WebSocket from "ws"
import { PROTOCOL_VERSION, type Discovery, type EditorMessage, type ToolName } from "@ai-pair/protocol"

export class RelayError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

function realpath(p: string): string {
  try {
    return fs.realpathSync(p)
  } catch {
    return p
  }
}

function contains(folder: string, file: string): boolean {
  const rel = path.relative(folder, file)
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === "EPERM"
  }
}

/** The live window whose workspace folder most closely contains `cwd`; the most recently focused on a tie. */
export function findWindow(cwd: string, dir: string): Discovery {
  const windows: Discovery[] = []
  let files: string[] = []
  try {
    files = fs.readdirSync(dir).filter((f) => f.endsWith(".json"))
  } catch {
    // No windows have registered yet.
  }
  for (const f of files) {
    try {
      const d = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")) as Discovery
      if (alive(d.pid)) windows.push(d)
    } catch {
      // Being written, or garbage.
    }
  }

  const here = realpath(cwd)
  let best: Discovery | undefined
  let bestLength = -1
  for (const w of windows) {
    for (const folder of w.workspaceFolders.map(realpath)) {
      if (!contains(folder, here)) continue
      if (folder.length > bestLength || (folder.length === bestLength && w.lastFocused > best!.lastFocused)) {
        best = w
        bestLength = folder.length
      }
    }
  }
  if (!best) {
    throw new RelayError(
      "no_editor",
      windows.length === 0
        ? `No VS Code window with the AI Pair extension is running. Ask the programmer to open ${cwd} in VS Code.`
        : `No VS Code window has ${cwd} open. Ask the programmer to open it in VS Code (with the AI Pair extension).`,
    )
  }
  return best
}

type Pending = {
  tool: ToolName
  cancelled: boolean
  resolve: (result: unknown) => void
  reject: (error: RelayError) => void
}

/** Tools whose results are reports, which must be delivered exactly once. */
const REPORTING: ReadonlySet<ToolName> = new Set(["step", "listen", "end"])

/** A lazily (re)connected link to the editor window for `cwd`. */
export class EditorLink {
  private ws: WebSocket | null = null
  private connecting: Promise<WebSocket> | null = null
  private nextId = 1
  private readonly pending = new Map<number, Pending>()

  constructor(
    private readonly cwd: string,
    private readonly dir: string,
  ) {}

  async call(tool: ToolName, args: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    const ws = await this.connect()
    const id = this.nextId++
    return new Promise((resolve, reject) => {
      const pending: Pending = { tool, cancelled: false, resolve, reject }
      this.pending.set(id, pending)
      ws.send(JSON.stringify({ type: "call", id, tool, args }))
      signal?.addEventListener(
        "abort",
        () => {
          pending.cancelled = true
          if (this.pending.has(id) && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "cancel", id }))
        },
        { once: true },
      )
    })
  }

  close(): void {
    this.ws?.close()
  }

  private connect(): Promise<WebSocket> {
    if (this.ws?.readyState === WebSocket.OPEN) return Promise.resolve(this.ws)
    this.connecting ??= this.open().finally(() => {
      this.connecting = null
    })
    return this.connecting
  }

  private open(): Promise<WebSocket> {
    const window = findWindow(this.cwd, this.dir)
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${window.port}`)
      let welcomed = false
      const settle = (id: number) => {
        const p = this.pending.get(id)
        this.pending.delete(id)
        return p
      }
      ws.on("open", () => {
        ws.send(JSON.stringify({ type: "hello", token: window.token, protocolVersion: PROTOCOL_VERSION }))
      })
      ws.on("message", (data) => {
        const m = JSON.parse(String(data)) as EditorMessage
        if (m.type === "welcome") {
          welcomed = true
          this.ws = ws
          resolve(ws)
        } else if (m.type === "rejected") {
          reject(new RelayError("no_editor", m.reason))
        } else if (m.type === "result") {
          const p = settle(m.id)
          // The call returned before our cancellation reached the editor, so the agent will never
          // see this report. Hand it back to be delivered with the next one.
          if (p?.cancelled && REPORTING.has(p.tool)) ws.send(JSON.stringify({ type: "return", report: m.result }))
          p?.resolve(m.result)
        } else if (m.type === "error") {
          settle(m.id)?.reject(new RelayError(m.code, m.message))
        }
      })
      ws.on("error", (e) => {
        if (!welcomed) reject(new RelayError("no_editor", `Couldn't connect to the editor: ${e.message}`))
      })
      ws.on("close", () => {
        if (this.ws === ws) this.ws = null
        if (!welcomed) reject(new RelayError("no_editor", "The editor closed the connection."))
        for (const p of this.pending.values()) {
          p.reject(new RelayError("no_editor", "The editor disconnected. If its window was reloaded, start a new session."))
        }
        this.pending.clear()
      })
    })
  }
}

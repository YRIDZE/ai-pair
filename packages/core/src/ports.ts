// What the core needs from the editor and the narration panel.

import type { Turn } from "@ai-pair/protocol"

export type AgentState = "typing" | "read" | "thinking" | "paused" | "listening" | "navigator"

export type CursorView = {
  file: string
  offset: number
  selection?: { start: number; end: number }
}

export type EditOptions = { undoStopBefore: boolean; undoStopAfter: boolean }

/** Files are absolute paths; offsets are into the document text. */
export interface EditorPort {
  /** Absolute path for a path given by the agent (absolute or workspace-relative). */
  resolvePath(file: string): string
  /** How to name a file to the agent. */
  displayPath(file: string): string
  /** Buffer contents if open, otherwise from disk. */
  getText(file: string): Promise<string>
  isDirty(file: string): Promise<boolean>
  /** Opens the file (creating it empty if missing) and makes it the visible editor. */
  show(file: string): Promise<void>
  edit(file: string, offset: number, deleteLength: number, text: string, options: EditOptions): Promise<void>
  save(file: string): Promise<void>
  renderCursor(cursor: CursorView | null, state: AgentState): void
  renderPoint(point: { file: string; start: number; end: number } | null): void
  /** Brings the programmer's view back to the agent cursor. */
  reveal(cursor: CursorView): void
}

export type PanelEvent =
  | { type: "session"; active: true; task?: string }
  | { type: "session"; active: false; reason: "agent" | "user" | "disconnected"; summary?: string }
  | { type: "say"; text: string }
  | { type: "reading"; ms: number }
  | { type: "state"; state: AgentState; turn: Turn; paused: boolean }
  | { type: "user"; text: string }
  | { type: "turn"; to: Turn; message?: string }
  | { type: "interrupt" }
  | { type: "point"; file: string; line: number }

export interface PanelPort {
  post(event: PanelEvent): void
}

/** A change to a document, in the coordinates of the text before it. */
export type Change = { offset: number; deleteLength: number; text: string }

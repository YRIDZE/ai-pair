// Types of the agent-facing protocol. See PROTOCOL.md.

export type Anchor = {
  text: string
  near_line?: number
}

/** A single anchor's match, or from the start of `from` to the end of the first `to` after it. */
export type Span = Anchor | { from: Anchor; to: { text: string } }

/** The offset between `before` and `after`, which occur together, exactly, placing it on `line`. */
export type Spot = { before: string; after: string; line: number }

/**
 * Where a `move` goes: on `line`, exactly, the spot between `before` and `after`, or the end of the
 * line. Without `line`, on the cursor's line.
 */
export type MoveTarget = {
  file?: string
  /** The line the cursor lands on, from 1. Omitted: the cursor's line. */
  line?: number
  /** A spot on the line: see `Spot`. */
  before?: string
  after?: string
  /** `end`: the end of the line. */
  to?: "end"
}

/** Typed as `before` then `after`, leaving the cursor between them. */
export type TypeText = [before: string, after: string]

export type Action =
  | { say: string }
  | { move: MoveTarget }
  | { select: Span }
  | { type: TypeText }
  | { type_fast: TypeText }
  | { delete: true }
  | { point: Span & { file?: string } }
  | { run: string; wait?: number }

/** The keys that name an action. An action object has exactly one of them. */
export const ACTION_KINDS = ["say", "move", "select", "type", "type_fast", "delete", "point", "run"] as const

/** The action keys an object has; more than one means actions were combined by mistake. */
export function actionKinds(value: object): string[] {
  return Object.keys(value).filter((k) => (ACTION_KINDS as readonly string[]).includes(k))
}

/** What's wrong with a `move`'s combination of fields, if anything. */
export function moveProblem(m: MoveTarget): string | undefined {
  if (m.line !== undefined && (!Number.isInteger(m.line) || m.line < 1)) {
    return "`line` is a line number, from 1, exactly as your latest `read` or report shows it. Omit it to stay on your cursor's line."
  }
  const spot = m.before !== undefined || m.after !== undefined
  if (spot && (m.before === undefined || m.after === undefined)) {
    return "A spot needs both `before` and `after` (either may be empty)."
  }
  if (spot && m.before === "" && m.after === "") return "`before` and `after` can't both be empty."
  if (spot && m.to !== undefined) return "Give one place on the line: `before`/`after`, or `to: \"end\"`, not both."
  if (!spot && m.to === undefined) return "Give the place on the line: `before`/`after`, or `to: \"end\"`."
  return undefined
}

export type Turn = "agent" | "user"

export type BatchStatus = "completed" | "interrupted" | "failed" | "discarded"

export type ErrorKind =
  | "anchor_not_found"
  | "anchor_ambiguous"
  | "no_selection"
  | "no_file"
  | "not_your_turn"
  | "invalid_action"
  | "command_failed"
  | "command_declined"

export type Candidate = { line: number; context: string }

export type RunResult = {
  command: string
  /** Absent when the command is still running, or its exit code couldn't be observed. */
  exit_code?: number
  output: string
  truncated?: true
  /** Still running: `wait` elapsed, or playback was interrupted. It keeps running in the terminal. */
  running?: true
  /** The terminal's shell, e.g. `pwsh` or `zsh`, when it's known. */
  shell?: string
}

/** Marks the agent cursor in a report's code. Anchors ignore it, so code can be copied from a report as is. */
export const CURSOR_MARKER = "▌"

/**
 * Lines of a file as they read, with the agent cursor marked. Long code skips lines in the middle. A
 * newline at the end of the file ends its last line: there's no empty line after it, unless the
 * cursor is there.
 */
export type Code = {
  file: string
  lines: { number: number; text: string }[]
  /** Present when the lines reach the end of the file: whether a newline ends its last line. */
  end?: { final_newline: boolean }
}

export type BatchError = { kind: ErrorKind; message: string; candidates?: Candidate[] }

export type BatchResult = {
  id: number
  status: BatchStatus
  /** The code the batch produced, as it read when the batch ended; also just the cursor's line after a move. */
  code?: Code
  /** The error of a failed batch, about the first action in `unplayed`. */
  error?: BatchError
  /**
   * The actions that didn't play, verbatim, ready to resubmit. An interrupted `type` comes first, reduced to
   * what it didn't type; a failed batch's failing action comes first.
   */
  unplayed?: Action[]
  runs?: RunResult[]
}

export type LineColumn = { line: number; column: number }

/** Code the programmer had selected when they wrote a message. */
export type Excerpt = {
  file: string
  from: LineColumn
  to: LineColumn
  text: string
  truncated?: true
}

export type Event =
  | { kind: "message"; text: string; selection?: Excerpt }
  /** `other`: not by the programmer, but by a tool, a formatter, or on disk. Only the programmer's interrupt. */
  | { kind: "edit"; file: string; diff: string; by: "programmer" | "other" }
  | { kind: "interrupt" }
  | { kind: "turn"; to: Turn; message?: string; selection?: Excerpt }
  | { kind: "end" }

export type Report = {
  batches: BatchResult[]
  /** The batch this `step` submitted, unless it's already finished and in `batches`. */
  submitted?: { id: number; status: "queued" | "playing" }
  /**
   * The batch this `step` was given, if it wasn't queued: played in memory, from where the queued
   * batches leave off, its action `index` (from 1) would fail. `code` is how the code would read then.
   */
  rejected?: { index: number; action: Action; error: BatchError; code?: Code }
  events: Event[]
  turn: Turn
  /** The agent cursor's line, when it isn't where the agent last saw it: in this report's code, or an earlier report. */
  cursor?: Code
  waiting?: true
}

export type FileContent = {
  file: string
  dirty: boolean
  /** As in `Code`: a newline at the end of the file ends its last line. An empty file has none. */
  lines: { number: number; text: string }[]
  /** Present when the lines reach the end of the file: whether a newline ends its last line. */
  end?: { final_newline: boolean }
}

export type ToolErrorCode = "no_session" | "session_active" | "no_editor" | "cancelled" | "invalid_arguments"

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    message: string,
  ) {
    super(message)
  }
}

export * from "./wire"

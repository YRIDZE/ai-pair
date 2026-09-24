# Pair Programmer Interaction Protocol

This document specifies how a coding agent and the editor extension interact
during a pair programming session. The agent talks to the extension over MCP;
the extension renders the agent's actions (a second cursor, typing, a narration
panel) and reports back what happened, including everything the programmer did.

This document covers only what the agent can do and observe. How the extension
presents it to the programmer is in [DESIGN.md](DESIGN.md), and how the tool is
built and connected is in [ARCHITECTURE.md](ARCHITECTURE.md).

Status: **draft**. Numbers marked *tunable* are initial guesses to be adjusted
by feel.

## Goals

- The programmer can follow everything the agent does, at a pace they can absorb.
- Narration is synchronized with the actions it describes.
- The programmer can interrupt, steer, or take over at any moment, and the
  agent always knows exactly what happened.
- Thinking time of the agent is hidden behind playback, so there are no awkward
  pauses between "think" and "act".

## Principles

1. **The extension is the source of truth.** The agent submits *intentions*;
   the extension reports what *actually happened*. The agent's picture of the
   world is always reconciled through reports.
2. **The programmer always preempts the agent.** Anything the programmer does
   takes effect immediately on their side. The agent learns about it on its
   next call.
3. **Events are delivered exactly once**, in the reports of `step` and `listen`.
4. **No stale plans.** A batch never plays if it was planned without knowledge
   of an interrupting event.
5. **During a session, the agent never ends its turn.** When it has nothing to
   do, it calls `listen` and waits for the programmer.

## Concepts

**Agent cursor.** A position (and optional selection) in a file, rendered as a
second cursor. The extension tracks it through the programmer's edits, like a
marker.

**Action.** A single visible operation: say something, move, select, type,
delete, point.

**Batch.** An ordered list of actions submitted in one `step` call. A batch is
the unit of planning: one idea, typically one narration plus the few edits it
describes.

**Playback.** The extension plays batches from a queue, at human speed.

**Report.** The result of a `step` or `listen` call: the outcome of finished
batches, plus events that happened since the last report.

**Turn.** Either the agent's turn (it drives, the programmer watches) or the
programmer's turn (the programmer drives, the agent can only comment). Turns
change only explicitly.

**Session.** One stretch of pairing, from `start` to its end. One harness
conversation can contain many sessions, one after another: the programmer
works with the agent as usual, pairs for a while, ends the session, and may
pair again later. Outside a session, all tools except `start` fail with
`no_session`.

## Timing model

In the normal case, the contract is:

> **Every `step` call submits a new batch and returns the report for the
> previous batch.**

Concretely:

1. The first `step` call returns immediately. Its batch starts playing and the
   agent goes on to think about the next batch.
2. The second `step` call queues its batch and **blocks until the first batch
   finishes playing**. It then returns the first batch's report, and the second
   batch starts playing.
3. And so on. The agent is always planning batch N+1 while the programmer
   watches batch N. It can never get more than one batch ahead.
4. After its last batch, the agent calls `listen`, which collects that batch's
   report and then waits for the programmer.

```
agent:      [think 1] step(1) [think 2] step(2)·····blocked·····  [think 3] step(3)····
playback:                     [==== batch 1 ====][==== batch 2 ====][==== batch 3 ====]
                                                  ^ step(2) returns report of batch 1
```

### Precise rules

The extension keeps a queue of batches. Each batch gets an id and ends with
one of these statuses:

| Status        | Meaning                                                              |
|---------------|----------------------------------------------------------------------|
| `completed`   | All actions played.                                                  |
| `interrupted` | Playback was stopped by an interrupting event partway through.       |
| `failed`      | An action could not be performed (e.g. an anchor didn't resolve).    |
| `discarded`   | Never started, because an earlier batch didn't complete or an interrupting event arrived first. |

Rules:

- **Blocking.** `step` enqueues its batch and blocks until the queue holds only
  that batch (i.e. everything before it finished), or until an interrupting
  event occurs.
- **Continuity.** A batch only starts playing if the batch before it
  `completed`. Otherwise it is `discarded`: it was planned assuming the previous
  batch's outcome, which didn't happen.
- **No stale plans.** If an interrupting event has occurred that the agent
  hasn't yet received in a report, a newly submitted batch is `discarded`
  immediately and the call returns right away.
- **Nothing is lost.** Unplayed actions of `interrupted`, `failed`, and
  `discarded` batches are returned verbatim, so the agent can resubmit them
  unchanged, modify them, or drop them.
- **Anchors resolve at play time.** Anchors in a batch are resolved when the
  action plays, not when the batch is submitted. A batch may therefore refer to
  text that an earlier, still-queued batch is going to type. (The agent's own
  typing is deterministic; only the programmer can break that prediction, and
  that is an interrupting event, covered by the rules above.)
- **Timeouts.** Any blocking call returns after at most `MAX_BLOCK` (*tunable*,
  ~60 s, safely below MCP client timeouts) even if nothing has finished, with
  `"waiting": true`. The agent simply calls `listen` to keep waiting. This
  covers long playbacks and paused playback.

### Pause and follow mode

During the agent's turn, the programmer's view **follows the agent cursor**,
so every `move` is visible to them.

Playback pauses when the programmer presses Pause or navigates away, and
resumes when they return. **Pausing is not an event**: the agent isn't told,
its blocked call just waits longer (subject to `MAX_BLOCK`).

## Tools

### `start(task?: string) -> Report`

Starts a session in the editor window for the current project. `task` is a
short description shown in the narration panel. Fails if a session is already
active in that window, or if no editor window has the project open.

The session starts in the agent's turn, with no agent cursor until the first
`move`.

### `end(summary?: string) -> Report`

Ends the session. Anything still queued plays out first. `summary` is shown as
the closing message in the narration panel. Returns the final report.

### `step(actions: Action[]) -> Report`

Submits a batch. Blocks as described in [Timing model](#timing-model).

### `listen() -> Report`

Collects the reports of all queued batches, then waits for the programmer.
Returns when:

- all batches have finished and a programmer event arrives (message, turn
  change, …), or
- a batch finishes with a status other than `completed`, or
- `MAX_BLOCK` elapses.

`listen` is how the agent "ends its turn" without actually ending it.

### `read(file: string, from_line?: number, to_line?: number) -> FileContent`

Returns the contents of a file **as it is in the editor buffer**, including
unsaved changes and everything played so far (but not text still queued for
playback). Falls back to disk for files that aren't open. Output includes line
numbers. Does not block and does not deliver events.

```ts
type FileContent = {
  file: string
  dirty: boolean          // buffer has unsaved changes
  lines: { number: number, text: string }[]
}
```

## Actions

```ts
type Action =
  | { say: string }
  | { move: (Anchor | { position: "file_start" | "file_end" })
            & { file?: string, at?: "start" | "end" } }
  | { select: Anchor | { from: Anchor, to: Anchor } }
  | { type: string }
  | { type_fast: string }
  | { delete: true }
  | { point: (Anchor | { from: Anchor, to: Anchor }) & { file?: string } }
```

Each editing action (`type`, `type_fast`, `delete`) is **one undo stop** in the
programmer's undo stack, not one per character. If the programmer undoes an
agent action, that is an edit like any other (and interrupts).

### `say`

Shows the text as the current message in the narration panel. It stays current
until the next `say`, then moves into the history. Inline code in backticks is
rendered as code.

After a `say`, playback **pauses for a reading time** proportional to the
message length, so the programmer can read most of it before the actions it
describes begin.

Keep messages short: one to three sentences. Split longer explanations across
batches.

### `move`

Moves the agent cursor. If `file` is given, switches to that file (opening it
if needed); otherwise anchors resolve in the current file. The cursor goes to
the `start` or `end` of the anchor match (default: `end`, i.e. "after").
Clears any selection. See [Anchors](#anchors).

Instead of an anchor, `position: "file_start"` or `"file_end"` may be given.

### `select`

Selects the anchor's match, or the range from the start of `from` to the end
of `to`. Rendered as a visible agent selection. The cursor ends at the end of
the selection.

### `type` and `type_fast`

Types text at the agent cursor, replacing the selection if there is one. The
cursor ends after the inserted text.

- `type` is the default: for anything the programmer should read and
  understand. It plays at a human-like pace.
- `type_fast` is for boilerplate the programmer doesn't need to read:
  `public static void Main`, closing braces, imports. It plays several times
  faster.

Text is inserted **literally**: no auto-closing brackets, no auto-indent, no
completions. The agent must include indentation itself. Newlines are
normalized to the document's line endings.

### `delete`

Deletes the current selection. Fails if there is no selection. (To delete, the
agent selects first, which makes deletions visible before they happen.)

### `point`

Highlights a range without editing it and without moving the agent cursor,
for talking about code: "this function is called from two places…". The
highlight persists until the next `point` or the next editing action.

During the agent's turn, if `file` is not the visible file, the view switches
to it. During the programmer's turn, the view never switches; the narration
panel shows a clickable reference instead.

## Anchors

An anchor identifies a location by **exact text**, with optional tie-breakers.

```ts
type Anchor = {
  text: string                           // exact match, may span lines
  near_line?: number                     // prefer the match closest to this line
  direction?: "forward" | "backward"     // nearest match after/before the agent cursor
}
```

Resolution:

1. Find all exact matches of `text` in the file.
2. Exactly one match: done.
3. Several matches: if `direction` is given, pick the nearest match in that
   direction from the agent cursor. Otherwise, if `near_line` is given, pick the
   match closest to that line.
4. Otherwise the action fails with `anchor_not_found` or `anchor_ambiguous`,
   listing candidates (line number plus a line of context) so the agent can
   retry with a tie-breaker.

Line numbers are poor addresses (the programmer's edits shift them) but good
tie-breakers: a hint that is off by a few lines still selects the right match.

## Reports

```ts
type Report = {
  batches: BatchResult[]      // batches that finished since the last report, in order
  submitted?: {               // the batch submitted by this call (step only)
    id: number
    status: "queued" | "playing" | "discarded"
    unplayed?: Action[]       // if discarded
  }
  events: Event[]             // programmer events since the last report, in order
  turn: "agent" | "user"
  cursor?: { file: string, line: number, column: number, selection?: Range }  // absent before the first move
  waiting?: true              // returned due to MAX_BLOCK; call listen to continue
}

type BatchResult = {
  id: number
  status: "completed" | "interrupted" | "failed" | "discarded"
  played: number              // number of fully played actions
  partial?: {                 // the action that was playing when stopped
    index: number
    typed: string             // for type/type_fast: exactly what made it into the buffer
  }
  unplayed?: Action[]         // remaining actions, verbatim (the partial one excluded)
  error?: {
    index: number
    kind: "anchor_not_found" | "anchor_ambiguous" | "no_selection" | "not_your_turn"
    candidates?: { line: number, context: string }[]
  }
}
```

A partially typed action stays in the buffer: if the programmer interrupts
mid-word, the half word remains, and `partial.typed` says exactly what was
typed.

## Events

```ts
type Event =
  | { kind: "message", text: string }
  | { kind: "edit", file: string, diff: string }
  | { kind: "interrupt" }
  | { kind: "turn", to: "agent" | "user", message?: string }
  | { kind: "end" }
```

During the agent's turn, **every event interrupts**: it stops playback and
triggers the no-stale-plans rule. This includes any edit by the programmer,
anywhere. (A finer rule, such as only edits near the agent cursor, may come
later.)

- `message`: the programmer sent a message from the narration panel.
- `interrupt`: the Interrupt button.
- `turn`: see [Turns](#turns).
- `edit`: the programmer changed a file. Edits are coalesced per file into a
  single diff per report.
- `end`: the programmer ended the session. Playback stops and the session is
  over: this is its final report, and further calls fail with `no_session`.

Pause is not an event; see [Pause and follow mode](#pause-and-follow-mode).

## Turns

Turns change only explicitly.

**Programmer takes the turn** ("My turn" button). This interrupts playback.
The agent receives `{ kind: "turn", to: "user" }`.

**During the programmer's turn**, the agent is the navigator:

- It may only `say` and `point`. Any other action fails with `not_your_turn`.
- It calls `listen` to follow along. `listen` returns on a message, on the turn
  change back, or when the programmer has made edits and then paused typing
  for a few seconds (*tunable*), so the agent can comment as a navigator
  would ("you'll want to handle the empty case there").

**Programmer hands the turn back** ("Your turn" button, optionally with a
message). The agent receives the programmer's edits since the last report and
`{ kind: "turn", to: "agent", message? }`.

## Files, saving, and native tools

- Files the agent edits via the protocol are **saved automatically** when a
  batch completes, so that tools reading from disk (tests, compilers, the
  agent's native file tools) see the current state.
- The agent may still use its native file tools. The rule is: anything the
  programmer should follow goes through the protocol; purely mechanical changes
  (generated files, lockfiles, bulk renames) may be done natively, announced in
  one `say`.
- The extension makes changes outside the protocol visible to the programmer,
  so a slip never goes unnoticed.
- The agent should not natively edit files that have unsaved changes in the
  editor; `read` reports `dirty` for this reason.
- **Terminal commands** are run with the agent's native tools; the protocol
  doesn't show them. The agent must narrate them instead: `say` what it's
  about to run and why before running it, and `say` what came out of it
  afterwards.

## Guidance for the agent

How the agent should use this protocol to give the programmer a good
experience (order of work, narration, background vs. visible work) is in
[AGENT_GUIDE.md](AGENT_GUIDE.md), the source text for the MCP server
instructions, tool descriptions, and the `/pair` prompt.

## Examples

### Normal flow

```jsonc
// → step
[{ "say": "Let's add the POST handler. Signature first." },
 { "move": { "file": "src/server.ts", "text": "app.use(express.json());\n" } },
 { "type": "\napp.post('/todos', async (req, res) => {\n" }]
// ← returns immediately
{ "batches": [], "submitted": { "id": 1, "status": "playing" }, "events": [], "turn": "agent", ... }

// → step (blocks until batch 1 finishes)
[{ "say": "We need a title from the body." },
 { "type": "  const { title } = req.body;\n" }]
// ←
{ "batches": [{ "id": 1, "status": "completed", "played": 3 }],
  "submitted": { "id": 2, "status": "playing" }, "events": [], ... }
```

### Interrupt mid-typing

```jsonc
// Batch 2 is playing; the agent has already submitted batch 3 and is blocked.
// The programmer replies in the narration panel: "use zod for validation".
// ← step returns immediately
{ "batches": [
    { "id": 2, "status": "interrupted", "played": 1,
      "partial": { "index": 1, "typed": "  const { ti" } },
    { "id": 3, "status": "discarded", "played": 0,
      "unplayed": [{ "say": "..." }, { "type": "..." }] }
  ],
  "events": [{ "kind": "message", "text": "use zod for validation" }], ... }

// → step
[{ "select": { "text": "  const { ti" } },
 { "say": "Good call. Let me define a schema instead." },
 { "delete": true }, ...]
```

### Ambiguous anchor

```jsonc
// ← report
{ "batches": [{ "id": 7, "status": "failed", "played": 1,
    "error": { "index": 1, "kind": "anchor_ambiguous",
      "candidates": [{ "line": 12, "context": "  return res.json(todos);" },
                     { "line": 31, "context": "  return res.json(todo);" }] },
    "unplayed": [...] }], ... }
```

### Turn handoff

```jsonc
// Programmer presses "My turn".
// ← { "events": [{ "kind": "turn", "to": "user" }], "turn": "user", ... }
// → listen
// ... programmer writes a loop, pauses typing ...
// ← { "events": [{ "kind": "edit", "file": "src/server.ts", "diff": "..." }], "turn": "user" }
// → step
[{ "point": { "text": "for (let i = 0; i <= todos.length; i++)" } },
 { "say": "Careful: `<=` will go one past the end." }]
// → listen
// ... programmer fixes it, presses "Your turn" ...
// ← { "events": [{ "kind": "edit", ... },
//               { "kind": "turn", "to": "agent", "message": "ok, finish the handler" }],
//     "turn": "agent" }
```

## Open questions

- **Navigator reporting.** How eagerly should `listen` report the programmer's
  edits during their turn? Too eager is noisy and costly; too lazy makes the
  navigator useless.
- **Sharing context.** Messages attached to a selection ("what does this
  do?"), and explicitly sharing the programmer's cursor. Not needed for the
  first prototype.
- **Interrupting edits.** Every edit interrupts for now. If that turns out too
  disruptive (e.g. fixing a typo in another file), narrow it to edits near the
  agent cursor or the region the current batch touched.
- **Terminal visibility.** Showing the agent's commands to the programmer
  (e.g. in an integrated terminal), beyond narration.

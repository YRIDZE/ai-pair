# Extension Design

How the extension looks and behaves for the programmer, and how it's built.
The contract with the agent is in [PROTOCOL.md](PROTOCOL.md); this document
covers everything the agent doesn't see.

Status: **draft**. Numbers marked *tunable* are initial guesses to be adjusted
by feel.

## Architecture

```
agent harness (Claude Code, …)
        │  MCP, streamable HTTP on 127.0.0.1
        ▼
┌─ extension ─────────────────────────────────────────────┐
│  MCP server                                             │
│        │                                                │
│  core (editor-agnostic)                                 │
│    batch queue, playback scheduler, anchor resolution,  │
│    cursor tracking, event log, reports, turn state      │
│        │                                                │
│  editor adapter (VS Code)          narration panel      │
│    edits, change events,  ◀──────▶ (webview)            │
│    decorations, scrolling                               │
└─────────────────────────────────────────────────────────┘
```

- **MCP server** runs inside the extension, one session per window, on a
  random localhost port. The extension writes a discovery file (port and auth
  token) and offers a command to add it to the agent's MCP config.
- **Core** holds all protocol logic and has no editor dependencies, so it can
  be tested against a fake editor and reused for Zed later.
- **Editor adapter** is a thin layer over the VS Code API: apply edits with
  undo stops, report document changes, render decorations, scroll, save.
- **Telling edits apart.** The adapter tracks the document versions produced by
  its own edits. Any change it didn't make is the programmer's (or an external
  tool's).

## Agent cursor

Rendered with decorations: a thin vertical bar in the agent's color, plus a
small name label. The agent's selection gets a background in the same color;
`point` highlights get a softer, distinct background.

The cursor's appearance shows the agent's state:

| State     | When                                               | Appearance                  |
|-----------|----------------------------------------------------|-----------------------------|
| typing    | playing `type`, `type_fast`, `move`, `select`, `delete` | agent color            |
| read      | reading pause after `say`                          | accent color, pulsing       |
| thinking  | queue empty, agent hasn't called yet               | dimmed                      |
| paused    | playback paused                                    | dimmed, pause marker        |
| listening | agent is in `listen`                               | outline only                |
| navigator | programmer's turn                                  | outline only, name label    |

The **read** state is the important one: it tells the programmer to look at the
narration panel. Decorations can't animate, so the pulse is done by swapping
decoration types on a timer.

Colors are contributed as theme colors, so themes and users can override them.

## Narration panel

A webview in the secondary side bar (right), so its top lines up with the top
of the editor. Some eye travel is acceptable, since the cursor's color change
and the reading pause lead the eye there, but the current message must be
highly visible and nothing in the panel may move unexpectedly.

Layout, top to bottom:

1. **Controls and reply box.** Pause/Resume, Interrupt, My turn / Your turn,
   speed. The reply box is slim and low-contrast until focused, so it doesn't
   compete with the message. These sit above the message so their position
   never changes.
2. **Current message.** Large text (≈1.4× the editor font, *tunable*), high
   contrast. Its **top edge is fixed**; its height grows downward with the
   message length. A new message briefly flashes in, in sync with the cursor's
   read state.
3. **Reading-pause bar** along the bottom edge of the current message. It fills
   during the reading pause, so the pause feels intentional, and is hidden
   otherwise.
4. **History**, newest first, in smaller, muted text. Besides the agent's
   messages it shows the programmer's replies, turn changes, interrupts, and
   changes made outside the protocol. File references are clickable.

Behavior:

- **Focusing the reply box pauses playback**, the way a pair stops when you
  start talking. Sending the reply delivers a `message` event (which
  interrupts). Leaving it empty and unfocusing resumes.
- A keyboard shortcut focuses the reply box from the editor.
- During the programmer's turn the panel shows "Your turn" prominently; the
  agent's comments appear as the current message as usual.

## Playback

### Typing cadence

| Parameter                          | Value (*tunable*)       |
|------------------------------------|-------------------------|
| `type` base rate                   | 15 chars/s              |
| `type_fast` base rate              | 60 chars/s              |
| per-character jitter               | ±30%                    |
| pause after `,` `;` `)` `}`        | +80 ms                  |
| pause at newline                   | +250 ms                 |
| leading indentation                | instant                 |

All rates are scaled by the programmer's speed setting.

Leading indentation appears instantly because that's what the programmer's own
editor would do; watching spaces being typed is noise.

### Reading pause

After a `say`: `clamp(words × 180 ms, 1 s, 6 s)`, scaled by the speed setting
(*tunable*). Enough to read most of the message, not all of it.

### Undo

Each editing action is one undo stop: characters are applied as successive
edits without undo stops between them, with stops at the action's boundaries.

### Follow mode

During the agent's turn:

- The view follows the agent cursor across files.
- The agent cursor is kept in the **upper third of the viewport**, so it sits
  roughly level with the narration panel's current message. The view scrolls
  only when the cursor leaves a comfortable band, not on every keystroke.
- Playback **pauses automatically** when the programmer switches to another
  editor or scrolls the agent cursor out of view. Scrolling caused by follow
  mode itself is ignored.
- **Resume always brings the view back to the agent cursor** first, then
  playback continues.

### Saving

Files edited through the protocol are saved when a batch completes.

## Changes outside the protocol

Files that change on disk without going through the protocol (the agent's
native tools, or anything else) are marked:

- a badge on the file in the explorer,
- an entry in the narration history ("`package.json` changed outside the
  editor") with a link to the diff.

The mark clears when the programmer opens the file or the diff. The extension
can't tell the agent's native edits from other tools (git, formatters), so the
wording stays neutral.

## Open questions

- **Setup flow.** Discovery file vs. a command that writes the harness's MCP
  config directly. How to make the first run trivial.
- **Panel placement.** Secondary side bar by default; is it wide enough for
  large text, or should the panel be an editor-group webview?
- **Focus-to-pause.** Does pausing when the reply box is focused feel natural,
  or does it surprise?
- **Bulk changes outside the protocol.** A bulk rename marks many files at
  once; the history entry should probably group them.

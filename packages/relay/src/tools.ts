// The MCP tool definitions: schemas and the descriptions the agent reads at the point of use.

import { z } from "zod"

const anchor = {
  text: z.string().describe("Exact text to find; may span lines. Keep it short, but unique."),
  near_line: z
    .number()
    .int()
    .optional()
    .describe("If the text occurs more than once, take the match closest to this line."),
  direction: z
    .enum(["forward", "backward"])
    .optional()
    .describe("If the text occurs more than once, take the nearest match after/before your cursor."),
}
const Anchor = z.object(anchor)
const Range = z.object({ from: Anchor, to: Anchor })
const file = z.string().describe("Path relative to your working directory, or absolute.")

const Action = z.union([
  z.object({
    say: z
      .string()
      .describe(
        "Narrate, before the actions it describes: intent, connections, tradeoffs. Never read code aloud. One to three sentences; `backticks` render as code. Playback pauses so the programmer can read it.",
      ),
  }),
  z.object({
    move: z
      .object({
        file: file.optional().describe("Switch to this file (created empty if it doesn't exist). Omit to stay in the current file."),
        ...anchor,
        text: anchor.text.optional(),
        at: z.enum(["start", "end"]).optional().describe("Put the cursor at the start or end (default) of the match."),
        position: z.enum(["file_start", "file_end"]).optional().describe("Instead of `text`."),
      })
      .describe("Move your cursor, to the end of an anchor's match (\"after this text\") or to a position."),
  }),
  z.object({
    select: z
      .union([Anchor, Range])
      .describe("Select an anchor's match, or everything from `from` to `to`, so the programmer sees what's about to change."),
  }),
  z.object({
    type: z
      .string()
      .describe(
        "Type at your cursor at a human pace, replacing the selection if there is one. Inserted literally: include newlines and indentation yourself; nothing is auto-closed. The default for anything the programmer should read.",
      ),
  }),
  z.object({
    type_fast: z
      .string()
      .describe("Like `type`, several times faster. Only for text the programmer doesn't need to read: imports, closing braces, config."),
  }),
  z.object({ delete: z.literal(true).describe("Delete the current selection; `select` first.") }),
  z.object({
    point: z
      .union([Anchor.extend({ file: file.optional() }), Range.extend({ file: file.optional() })])
      .describe("Highlight code without editing it or moving your cursor, to talk about it. Put the `say` after it."),
  }),
])

export const TOOLS = {
  start: {
    description:
      "Start a live pair programming session in the programmer's editor. Call this when the programmer asks to pair. The result includes the pairing guide: read it and follow it for the whole session. From then on, everything you do through `step` appears in their editor at a human pace, with your narration.",
    inputSchema: {
      task: z.string().optional().describe("A short description of what you'll work on, shown to the programmer."),
    },
  },
  step: {
    description: `Submit a batch of visible actions, played in the programmer's editor at a human pace. A batch is one idea: usually a \`say\` explaining what's next, then the few edits it describes.

Pipelined: the call queues the batch and returns once the PREVIOUS batch has finished playing, with that batch's report. So plan the next batch while this one plays. The first call returns immediately.

Read every report. If a batch was interrupted or failed, or the programmer said or did something (\`events\`), your later batches were discarded; their actions come back in \`unplayed\`. Take what happened into account and re-plan. \`partial.typed\` says exactly what made it into the file. With \`waiting: true\`, nothing has finished yet: carry on as usual.

An empty batch waits for your queued batches without waiting for the programmer.`,
    inputSchema: {
      actions: z.array(Action).describe("Played in order."),
    },
  },
  listen: {
    description:
      "Wait for the programmer. First collects the reports of your queued batches, then returns when the programmer does something: a message, an edit, a turn change, or ending the session. Call it whenever you're done or waiting: during a session, never end your turn. During the programmer's turn you're the navigator (only `say` and `point` work), and `listen` also returns shortly after they stop typing, so you can comment. With `waiting: true`, nothing happened yet: call it again.",
    inputSchema: {},
  },
  end: {
    description:
      "End the session, when the programmer says they're done. Anything still queued plays out first. Afterwards the pair tools are unavailable until the next `start`; continue the conversation normally.",
    inputSchema: {
      summary: z.string().optional().describe("One or two sentences, shown to the programmer as the closing message."),
    },
  },
  read: {
    description:
      "Read a file as it is in the programmer's editor, including unsaved changes and everything you've typed so far. Prefer this over your own file tools for files the programmer may have touched during the session. Lines are numbered from 1.",
    inputSchema: {
      file,
      from_line: z.number().int().optional(),
      to_line: z.number().int().optional(),
    },
  },
} as const

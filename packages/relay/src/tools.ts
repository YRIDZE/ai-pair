// The MCP tool definitions: schemas and the descriptions the agent reads at the point of use.

import { z } from "zod"
import { ACTION_KINDS, actionKinds, moveProblem, type MoveTarget } from "@ai-pair/protocol"

const nearLine = z
  .number()
  .int()
  .optional()
  .describe("The line the text starts at, from your latest `read` or report. Give it whenever you know it: of several matches, the one closest to it is taken.")
const Anchor = z.strictObject({
  text: z.string().describe("Exact text; may span lines. Long enough to occur only once, e.g. a whole line."),
  near_line: nearLine,
})
const Range = z.strictObject({
  from: Anchor,
  to: z.strictObject({ text: z.string().describe("Exact text; its first match after `from` ends the range.") }),
})
const file = z.string().describe("Path relative to your working directory, or absolute.")
const typeText = z.tuple([z.string(), z.string()])

const Action = z.union([
  action({
    say: z
      .string()
      .describe(
        "Narrate right before the actions it describes: what you're doing, why, and how your code does it. It's about your code and your choices, not how the language or its libraries work (unless the programmer asked to learn them). Explain the code, don't recite it. One to three sentences; `backticks` render as code. Playback pauses so the programmer can read it.",
      ),
  }),
  action({
    move: z
      .strictObject({
        file: file.optional().describe("Switch to this file (created empty if it doesn't exist). Omit to stay in the current file."),
        line: z
          .number()
          .int()
          .optional()
          .describe(
            "The line your cursor lands on, exactly as an up-to-date `read` or report shows it. Never count lines or guess: if you haven't seen the line's number since your batches last changed the lines above it, `read` first. A number you haven't been shown for that line is rejected. Omit it to stay on your cursor's line.",
          ),
        at: z
          .string()
          .optional()
          .describe(
            "A spot: the exact text around it, with ▌ where your cursor goes, e.g. `\"import { ▌type Context\"` for right before `type Context`. May span lines. Enough text to fit only one place on the line.",
          ),
        to: z
          .enum(["line_end"])
          .optional()
          .describe(
            "Instead of a spot: `line_end`, the end of the line. Only that: it steps past a close you typed only if that close is on this line. A block's closing brace, below its body, isn't on your cursor's line.",
          ),
      }, { error: (issue) => (issue.code === "unrecognized_keys" ? moveProblem(issue.input as MoveTarget) : undefined) })
      .superRefine((m, ctx) => {
        const problem = moveProblem(m)
        if (problem) ctx.addIssue({ code: "custom", message: problem })
      })
      .describe(
        "Move your cursor to a spot, `at`: the text around it with ▌ where your cursor goes (`line: 3, at: \"import { ▌type Context\"` lands right before `type Context`), or to the end of the line with `to: \"line_end\"`. On `line`, exactly: a spot that isn't on it is rejected. Without `line`, on your cursor's line: that's how you step past a close you just typed on your line, e.g. `{ to: \"line_end\" }`.",
      ),
  }),
  action({
    select: z
      .union([Anchor, Range])
      .describe(
        "Select an anchor's match, or from the start of `from` to the end of the first `to` after it, so the programmer sees what's about to change.",
      ),
  }),
  action({
    type: typeText.describe(
      "`[before, after]`: types `before`, then `after`, at a human pace, then steps your cursor back to between them. Replaces the selection if there is one. Inserted literally: include newlines and indentation yourself; nothing is auto-closed. The default for anything the programmer should read. The programmer watches every keystroke, and every second they see an unclosed bracket, parenthesis, quote or block is a second of suffering for them, so close each one the moment you open it, always, however short: `[\"f(\", \")\"]` then `[\"x\", \"\"]`, never `[\"f(x)\", \"\"]`. Type left to right, except that whatever has a close gets its close first: when `before` opens a bracket, a quote or a block (however the language spells it: `{`, `begin`, `then`, `do`, a tag, a block comment), `after` is its close and nothing more. Fill it, step past its close (a `move` to the end of its line, or to a spot right after it; `to: \"line_end\"` is only the end of your cursor's line, so it doesn't step past a block's close on the line below), and type what follows there: `[\"if (\", \")\"]`, `[\"x < 0\", \"\"]`, `to: \"line_end\"`, `[\" {\\n    \", \"\\n  }\"]`, then the body; `[\"(\", \")\"]`, `[\"x + y\", \"\"]`, `to: \"line_end\"`, `[\" * SCALE;\", \"\"]`. `after` is `\"\"` when `before` opens nothing. Start new lines at the end of the line above, never where code follows on the line: it would slide right as you type. Separate definitions with one blank line, `[\"\\n\\n…\", …]` at the end of the one above, and leave one newline at the end of the file.",
    ),
  }),
  action({
    type_fast: typeText.describe(
      "Like `type`, several times faster, for text the programmer doesn't need to read: imports, config, boilerplate. Only the speed changes: closes still come first.",
    ),
  }),
  action({ delete: z.literal(true).describe("Delete the current selection; `select` first.") }),
  action({
    point: z
      .union([Anchor.extend({ file: file.optional() }), Range.extend({ file: file.optional() })])
      .describe(
        "Highlight code without editing it or moving your cursor, to talk about it: point first, then `say` what's there. The programmer's view goes to the pointed code, and comes back to your cursor with your next move or edit.",
      ),
  }),
  action({
    run: z
      .string()
      .describe(
        "Run a shell command in a terminal the programmer sees: tests, builds, starting the app. They may be asked to allow it. The exit code, the output and the terminal's shell come back in the batch's report; a nonzero exit fails the batch. Make it the last action of its batch.",
      ),
    wait: z.number().optional().describe("Seconds to wait (default 120). For a server, a few: it keeps running."),
  }),
], { error: actionError })

/** An action's object: no unknown fields, and a clear message when two actions were put in one. */
function action<T extends z.ZodRawShape>(shape: T) {
  return z.strictObject(shape, { error: (issue) => (issue.code === "unrecognized_keys" ? combined(issue.input) : undefined) })
}

/** Says what's wrong with an action that matches no variant, instead of zod's bare "Invalid input". */
function actionError(issue: { input?: unknown }): string | undefined {
  const input = issue.input
  if (typeof input !== "object" || input === null || Array.isArray(input)) return undefined
  const kinds = actionKinds(input)
  if (kinds.length === 0) return `Not an action: each action has one of ${ACTION_KINDS.map((k) => `\`${k}\``).join(", ")}`
  if (kinds.length > 1) return combined(input)
  // A move with a malformed line fails on the line's type, before `moveProblem` gets to say what's wrong.
  const move: unknown = "move" in input ? input.move : undefined
  if (typeof move === "object" && move !== null) return moveProblem(move as MoveTarget)
  return undefined
}

function combined(input: unknown): string | undefined {
  if (typeof input !== "object" || input === null) return undefined
  const kinds = actionKinds(input)
  if (kinds.length < 2) return undefined
  return `One action per object, got ${kinds.map((k) => `\`${k}\``).join(" and ")}: make them separate actions, in order`
}

export const TOOLS = {
  start: {
    description:
      "Start a live pair programming session in the programmer's editor. Call this when the programmer asks to pair. The result includes the pairing guide: read it and follow it for the whole session. From then on, everything you do through `step` appears in their editor at a human pace, with your narration.",
    inputSchema: {
      task: z.string().optional().describe("A short description of what you'll work on, shown to the programmer."),
    },
  },
  step: {
    description: `Submit a batch of visible actions, played in the programmer's editor at a human pace. A batch is one idea: usually a \`say\` explaining what's next, then the few edits it describes. A batch works in one file: name it (in \`move\` or \`point\`) before its first edit, and start a new batch to switch files.

Pipelined: the call queues the batch and returns once the PREVIOUS batch has finished playing, with that batch's report. So plan the next batch while this one plays. The first call returns immediately.

A batch that would fail, e.g. on an anchor that doesn't match, may be rejected at once: nothing of it is queued, and the report says which action and why. Fix it and submit the whole batch again.

Read every report. It shows each finished batch's code as it now reads, with your cursor marked \`▌\`: check it's what you meant. If a batch was interrupted or failed, or the programmer said or did something, your later batches were discarded; what didn't play is listed, ready to resubmit, starting with what's left of an interrupted action. Take what happened into account and re-plan.

An empty batch waits for your queued batches without waiting for the programmer.`,
    inputSchema: {
      actions: z.array(Action).describe("Played in order."),
    },
  },
  listen: {
    description:
      "Wait for the programmer. First collects the reports of your queued batches, then returns when the programmer does something: a message (with the code they had selected, if any), an edit of theirs, a turn change, or ending the session. Call it whenever you're done or waiting: during a session, never end your turn. During the programmer's turn you're the navigator (only `say` and `point` work), and `listen` also returns shortly after they stop typing, so you can comment. If nothing happened in time, it says so: call it again.",
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
      "Read a file as it is in the programmer's editor, including unsaved changes, and as your batches will leave it: what they'll type is already in it, even while they're still playing or queued, so its line numbers are the ones your next batch starts from. Read the part of a file you're about to work in before you move there, and copy anchors and line numbers from it: don't guess them. Prefer this over your own file tools during the session. Lines are numbered from 1; it says where the file ends, and whether a newline ends its last line.",
    inputSchema: {
      file,
      from_line: z.number().int().optional(),
      to_line: z.number().int().optional(),
    },
  },
} as const

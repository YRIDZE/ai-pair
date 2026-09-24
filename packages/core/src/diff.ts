import { createPatch } from "diff"

/** A unified diff of the change, hunks only (the file is named in the event). */
export function fileDiff(file: string, before: string, after: string): string {
  const patch = createPatch(file, before, after, undefined, undefined, { context: 2 })
  const firstHunk = patch.indexOf("\n@@")
  return firstHunk === -1 ? "" : patch.slice(firstHunk + 1).trimEnd()
}

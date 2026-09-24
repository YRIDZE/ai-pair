// A scripted "agent" that plays the example session from AGENT_GUIDE.md through the real
// protocol, for tuning how playback feels. It can't adapt, so it stops when interrupted.

import * as path from "node:path"
import * as vscode from "vscode"
import type { Controller } from "@ai-pair/core"
import type { Action, Report } from "@ai-pair/protocol"

const DIR = "ai-pair-demo/src"
const SERVER = `${DIR}/server.ts`
const TODOS = `${DIR}/todos.ts`

const INITIAL_SERVER = `import express from "express";

const app = express();
app.use(express.json());

app.listen(3000, () => console.log("Listening on http://localhost:3000"));
`

// Follows AGENT_GUIDE.md: make room before typing, delimiters before contents, and narrate
// what, why, and how right before the code it's about.
const SCRIPT: Action[][] = [
  [{ say: "Let me look at how the app is set up first." }, { move: { file: SERVER, position: "file_start" } }],
  [
    {
      say: "It's a single Express app in `server.ts`, with no database. I'll keep todos in memory for now, so we can focus on Express itself. Stop me if you'd prefer a real database.",
    },
  ],
  [
    {
      say: "The plan: a `Todo` type and a small in-memory store in `todos.ts`, then REST routes in `server.ts`. We'll get creating a todo working end to end first, then add the rest.",
    },
  ],
  [
    { say: "First, the shape of a todo: a type with an id, a title, and whether it's done." },
    { move: { file: TODOS, position: "file_start" } },
    { type: "export type Todo = {\n};\n" },
    { move: { text: "Todo = {", direction: "backward" } },
    { type: "\n  id: number;\n  title: string;\n  done: boolean;" },
  ],
  [
    { say: "The store is just an array and a counter for ids. `createTodo` is what the routes will call." },
    { move: { position: "file_end" } },
    { type: "\nconst todos: Todo[] = [];\nlet nextId = 1;\n\nexport function createTodo(title: string): Todo {\n}\n" },
    { move: { text: "): Todo {", direction: "backward" } },
    { say: "It takes the next id, pushes the new todo onto the array, and returns it, so the route can send it straight back." },
    { type: "\n  const todo = { id: nextId++, title, done: false };\n  todos.push(todo);\n  return todo;" },
  ],
  [
    {
      say: "Now the route. In Express, a route is an HTTP method, a path, and a handler that receives the request and the response.",
    },
    { move: { file: SERVER, text: "app.use(express.json());" } },
    { type: '\n\napp.post("/todos", (req, res) => {\n});' },
    { move: { text: "(req, res) => {", direction: "backward" } },
  ],
  [
    { point: { text: "app.use(express.json());" } },
    { say: "`express.json()` up here is what parses the request body, so `req.body` is an object in our handler." },
    { say: "We create the todo from the body's `title`, and answer 201 Created with the new todo as JSON." },
    { type: "\n  const todo = createTodo(req.body.title);\n  res.status(201).json(todo);" },
  ],
  [
    { say: "We need to import `createTodo`." },
    { move: { text: 'import express from "express";' } },
    { type_fast: '\nimport { createTodo } from "./todos";' },
  ],
  [
    {
      say: "In a real session I'd now start the server and send a request to check it works. This is a scripted demo, so let's say it answered 201 with the new todo.",
    },
  ],
  [
    { say: "Next, listing todos. First a function in the store that hands out the array." },
    { move: { file: TODOS, position: "file_end" } },
    { type: "\nexport function listTodos(): Todo[] {\n}\n" },
    { move: { text: "listTodos(): Todo[] {", direction: "backward" } },
    { type: "\n  return todos;" },
  ],
  [
    { say: "And the route for it, right after the POST handler: `GET /todos` sends the list back as JSON." },
    { move: { file: SERVER, text: "});" } },
    { type: '\n\napp.get("/todos", (req, res) => {\n});' },
    { move: { text: "(req, res) => {", direction: "backward" } },
    { type: "\n  res.json(listTodos());" },
  ],
  [
    { say: "It needs the import too." },
    { select: { text: "{ createTodo }" } },
    { type: "{ createTodo, listTodos }" },
  ],
]

const SUMMARY =
  "That's the demo: the direction first, then one path end to end, then broadening one case at a time. Updating and deleting would follow the same cycle."

function derailed(report: Report): boolean {
  return report.events.length > 0 || report.batches.some((b) => b.status !== "completed")
}

export async function playDemo(controller: Controller, root: string): Promise<void> {
  if (controller.isActive) {
    void vscode.window.showWarningMessage("A pairing session is already active.")
    return
  }
  const server = vscode.Uri.file(path.join(root, SERVER))
  await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.join(root, DIR)))
  await vscode.workspace.fs.writeFile(server, new TextEncoder().encode(INITIAL_SERVER))
  try {
    await vscode.workspace.fs.delete(vscode.Uri.file(path.join(root, TODOS)))
  } catch {
    // Not there yet.
  }

  try {
    await controller.start("Demo: add a todos API to an Express app")
    for (const batch of SCRIPT) {
      const report = await controller.step(batch)
      if (report.events.some((e) => e.kind === "end")) return
      if (derailed(report)) return await stopEarly(controller)
    }
    // An empty batch collects the last batch's report without waiting for the programmer.
    const report = await controller.step([])
    if (report.events.some((e) => e.kind === "end")) return
    if (derailed(report)) return await stopEarly(controller)
    await controller.end(SUMMARY)
  } catch (e) {
    // The session was ended or replaced.
    console.error("AI Pair demo stopped:", e)
  }
}

async function stopEarly(controller: Controller): Promise<void> {
  await controller.step([{ say: "I'm a scripted demo, so I can't adapt to that. Let's stop here." }])
  await controller.end()
}

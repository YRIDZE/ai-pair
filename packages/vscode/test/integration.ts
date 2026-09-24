// Runs inside a real VS Code (see scripts/integration.sh): plays the demo and checks the result,
// then checks that a programmer edit interrupts the agent with an exact report.

import * as assert from "node:assert/strict"
import * as path from "node:path"
import * as vscode from "vscode"
import type { Api } from "../src/extension"

const EXPECTED_TODOS = `export type Todo = {
  id: number;
  title: string;
  done: boolean;
};

const todos: Todo[] = [];
let nextId = 1;

export function createTodo(title: string): Todo {
  const todo = { id: nextId++, title, done: false };
  todos.push(todo);
  return todo;
}

export function listTodos(): Todo[] {
  return todos;
}
`

const EXPECTED_SERVER = `import express from "express";
import { createTodo, listTodos } from "./todos";

const app = express();
app.use(express.json());

app.post("/todos", (req, res) => {
  const todo = createTodo(req.body.title);
  res.status(201).json(todo);
});

app.get("/todos", (req, res) => {
  res.json(listTodos());
});

app.listen(3000, () => console.log("Listening on http://localhost:3000"));
`

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

export async function run(): Promise<void> {
  const ext = vscode.extensions.getExtension("ai-pair.ai-pair")
  assert.ok(ext, "extension not found")
  const api = (await ext.activate()) as Api
  const root = vscode.workspace.workspaceFolders![0]!.uri.fsPath
  const file = (name: string) => path.join(root, name)
  const buffer = async (name: string) => (await vscode.workspace.openTextDocument(file(name))).getText()
  const disk = async (name: string) =>
    new TextDecoder().decode(await vscode.workspace.fs.readFile(vscode.Uri.file(file(name))))

  // The demo, sped up. If our own edits were mistaken for the programmer's, it would stop early.
  api.controller.setSpeed(20)
  const started = Date.now()
  await api.playDemo()
  console.log(`demo played in ${Date.now() - started} ms`)
  assert.equal(await buffer("ai-pair-demo/src/todos.ts"), EXPECTED_TODOS)
  assert.equal(await buffer("ai-pair-demo/src/server.ts"), EXPECTED_SERVER)
  assert.equal(await disk("ai-pair-demo/src/server.ts"), EXPECTED_SERVER, "saved after each batch")

  // A programmer edit mid-typing interrupts, and the report says exactly what was typed.
  const c = api.controller
  c.setSpeed(1)
  const alphabet = "abcdefghijklmnopqrstuvwxyz"
  await c.start("interrupt test")
  await c.step([{ move: { file: "scratch.ts" } }, { type: alphabet }])
  const pending = c.step([{ type: "!" }])
  await sleep(900)
  const doc = await vscode.workspace.openTextDocument(file("scratch.ts"))
  const edit = new vscode.WorkspaceEdit()
  edit.insert(doc.uri, new vscode.Position(0, 0), "// mine\n")
  await vscode.workspace.applyEdit(edit)

  const report = await pending
  const [typing, next] = report.batches
  assert.equal(typing?.status, "interrupted")
  const typed = typing.partial?.typed ?? ""
  assert.ok(typed.length > 0 && alphabet.startsWith(typed), `typed: ${JSON.stringify(typed)}`)
  assert.equal(next?.status, "discarded")
  assert.equal(report.events[0]?.kind, "edit")
  assert.equal(doc.getText(), "// mine\n" + typed)
  assert.deepEqual(report.cursor, { file: "scratch.ts", line: 2, column: typed.length + 1 })
  await c.end()
  console.log(`interrupted after typing ${JSON.stringify(typed)}`)
}

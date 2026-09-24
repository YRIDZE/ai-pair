// The launcher for pair-mcp, and connecting it to the programmer's agent.
// See "Starting a session" and "Distribution" in ARCHITECTURE.md.

import * as fs from "node:fs"
import * as os from "node:os"
import * as path from "node:path"
import * as vscode from "vscode"
import { aiPairHome } from "@ai-pair/protocol"

/**
 * Writes a launcher at a fixed path that runs this version's relay with VS Code's own runtime,
 * so the agent's MCP configuration never changes and Node needn't be installed.
 */
export function writeLauncher(extensionPath: string): string {
  const bin = path.join(aiPairHome(), "bin")
  fs.mkdirSync(bin, { recursive: true })
  const relay = path.join(extensionPath, "dist", "relay.js")
  if (process.platform === "win32") {
    const launcher = path.join(bin, "pair-mcp.cmd")
    fs.writeFileSync(launcher, `@echo off\r\nset ELECTRON_RUN_AS_NODE=1\r\n"${process.execPath}" "${relay}" %*\r\n`)
    return launcher
  }
  const launcher = path.join(bin, "pair-mcp")
  fs.writeFileSync(launcher, `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec "${process.execPath}" "${relay}" "$@"\n`, { mode: 0o755 })
  return launcher
}

function quoted(p: string): string {
  return /[\s"'$`\\]/.test(p) ? `"${p.replace(/(["\\$`])/g, "\\$1")}"` : p
}

export async function setUpAgent(launcher: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0]
  const choice = await vscode.window.showQuickPick(
    [
      {
        label: "Claude Code (CLI)",
        description: "All projects: runs `claude mcp add` in a terminal",
        id: "claude",
      },
      {
        label: "Claude Code (this project)",
        description: "Writes .mcp.json here; also works in the Claude desktop app",
        id: "project",
        disabled: !folder,
      },
      { label: "Another agent", description: "Copies an MCP server configuration to the clipboard", id: "other" },
    ].filter((c) => !c.disabled),
    { title: "Which agent do you pair with?" },
  )
  if (!choice) return

  if (choice.id === "claude") {
    const terminal = vscode.window.createTerminal({ name: "AI Pair setup" })
    terminal.show()
    terminal.sendText(`claude mcp add --scope user pair -- ${quoted(launcher)}`)
    void vscode.window.showInformationMessage(
      "Once it's added, restart Claude Code and ask it to pair, or run the `start` prompt of the pair server.",
    )
    return
  }

  if (choice.id === "project" && folder) {
    const file = path.join(folder.uri.fsPath, ".mcp.json")
    let config: { mcpServers?: Record<string, unknown> } = {}
    try {
      config = JSON.parse(fs.readFileSync(file, "utf8")) as typeof config
    } catch {
      // Missing or unreadable: start fresh.
    }
    config.mcpServers = { ...config.mcpServers, pair: { type: "stdio", command: portable(launcher) } }
    fs.writeFileSync(file, JSON.stringify(config, null, 2) + "\n")
    void vscode.window.showInformationMessage(
      "Wrote .mcp.json. Start a new Claude Code session in this folder, approve the pair server, and ask it to pair.",
    )
    return
  }

  const config = { mcpServers: { pair: { command: launcher } } }
  await vscode.env.clipboard.writeText(JSON.stringify(config, null, 2))
  void vscode.window.showInformationMessage(
    `Copied. Add it to your agent's MCP configuration: a stdio server named "pair" running ${launcher}.`,
  )
}

/** The launcher's path with the home directory as a variable, so the file works for anyone who clones the project. */
function portable(launcher: string): string {
  const home = os.homedir()
  if (!launcher.startsWith(home + path.sep)) return launcher
  const variable = process.platform === "win32" ? "${USERPROFILE}" : "${HOME}"
  return variable + launcher.slice(home.length)
}

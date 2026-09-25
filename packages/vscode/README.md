# AI Pair Programmer

Pair program with an AI agent. The agent gets its own cursor in your editor. It
types at a human pace and narrates what it's doing in the **Pair** panel, and
you can interrupt it, reply, or take over at any moment.

It works with your existing coding agent (tested with Claude Code) through MCP.

## Set up

1. Open a project folder.
2. Run **AI Pair: Set Up Agent** and pick your agent:
   - **Claude Code (CLI)** registers the server for all your projects.
   - **Claude Code (this project)** writes a `.mcp.json`. Use this for the
     Claude desktop app.
   - **Another agent** copies an MCP configuration: a stdio server named `pair`
     running `~/.ai-pair/bin/pair-mcp`.
3. Restart your agent.

## Pair

Start your agent in the folder that's open in VS Code and ask it to pair ("let's
pair on…"). In Claude Code you can also run `/mcp__pair__start`.

- **Reply:** type in the panel's reply box and press Enter. Typing pauses
  playback.
- **Ask about some code:** select it in the editor, then reply; the selection
  goes along (× leaves it out). Or right-click it: *Ask the Agent About the
  Selection*.
- **Commands:** the agent's tests and builds play in an *AI Pair* terminal.
  Choose **Run**, **Allow for session**, or **Skip** in the panel.
- **Interrupt:** the button, or just edit the code.
- **Look around:** scrolling or switching files pauses playback. **Resume**
  brings you back.
- **My turn / Your turn:** write a part yourself while the agent navigates.
- **Slow / Normal / Fast:** the pace.

**AI Pair: Play Demo Session** shows what it's like without an agent.

## Settings

- `aiPair.speed`: overall playback speed.
- `aiPair.agentName`: the name on the agent's cursor.
- `aiPair.timing`: fine-tune any typing or pause duration.
- `aiPair.confirmCommands`: ask before each command the agent runs in the
  terminal (on by default).

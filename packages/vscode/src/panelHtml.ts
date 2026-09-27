// The narration panel's page. Layout, top to bottom: the card, whose header holds the status and the
// controls, then the current message (top edge fixed, grows downward) with the reading-pause bar,
// then the reply box at the card's bottom; below the card, the history, newest first.

import { randomBytes } from "node:crypto"

/** Speeds offered in the panel's menu. The `aiPair.speed` setting takes any value. */
export const SPEEDS = [0.4, 0.6, 1, 1.5, 2, 3]

const svg = (paths: string, cls = "") =>
  `<svg class="i ${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`

const ICONS = {
  pause: svg('<path d="M9 5v14M15 5v14"/>', "pause"),
  resume: svg('<path d="M8 5l11 7-11 7z"/>', "resume"),
  stop: svg('<rect x="6" y="6" width="12" height="12" rx="2"/>', "accent"),
  swap: svg('<path d="M7 7h11l-3-3M17 17H6l3 3"/>', "accent"),
  exit: svg('<path d="M14 4h5v16h-5M10 8l-4 4 4 4M6 12h11"/>'),
  send: svg('<path d="M4 12l16-8-6 16-2.5-6.5z"/>'),
  play: svg('<path d="M8 5l11 7-11 7z"/>'),
}

export function panelHtml(cspSource: string): string {
  const nonce = randomBytes(16).toString("base64")
  const speeds = SPEEDS.map(
    (s) => `<button role="menuitemradio" aria-checked="false" data-speed="${s}">${s.toFixed(1)}×</button>`,
  ).join("")
  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  :root {
    --accent: var(--vscode-aiPair-cursor, #e8875b);
    --read: var(--vscode-aiPair-cursorRead, #facc15);
    --read-tint: color-mix(in srgb, var(--read) 18%, transparent);
    --muted: var(--vscode-descriptionForeground);
    --border: var(--vscode-widget-border, var(--vscode-panel-border, rgba(128, 128, 128, 0.22)));
    --surface: var(--vscode-editor-background);
    --soft: color-mix(in srgb, var(--vscode-foreground) 7%, transparent);
    --soft-hover: color-mix(in srgb, var(--vscode-foreground) 13%, transparent);
    --you: var(--vscode-charts-blue, #3794ff);
    --you-tint: color-mix(in srgb, var(--you) 14%, transparent);
    --ok: var(--vscode-testing-iconPassed, #73c991);
    --fail: var(--vscode-testing-iconFailed, var(--vscode-errorForeground, #f14c4c));
    /* The agent's words: the current message and the history's. */
    --narration: var(--vscode-font-family);
    --mono: var(--vscode-editor-font-family, monospace);
  }
  html, body { height: 100%; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
  }
  #app { display: flex; flex-direction: column; height: 100%; }

  button {
    font: inherit; font-size: 12px; height: 28px; min-width: 28px; box-sizing: border-box; padding: 0 7px;
    display: inline-flex; align-items: center; justify-content: center; gap: 5px; flex: none;
    border: none; border-radius: 6px; cursor: pointer; background: transparent; color: var(--vscode-foreground);
  }
  button:focus-visible { outline: 1px solid var(--vscode-focusBorder); outline-offset: 1px; }
  button:disabled { opacity: 0.45; cursor: default; }
  button.quiet { color: var(--muted); }
  button.quiet:hover:not(:disabled), button.quiet.on { background: var(--soft); color: var(--vscode-foreground); }
  button.soft { background: var(--soft); }
  button.soft:hover:not(:disabled) { background: var(--soft-hover); }
  button.primary { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  button.primary:hover:not(:disabled) { background: var(--vscode-button-hoverBackground); }
  .i { width: 14px; height: 14px; flex: none; }
  .i.accent { color: var(--accent); }

  #card {
    flex: none; margin: 12px 12px 0; border-radius: 10px;
    background: var(--surface); border: 1px solid var(--border);
  }
  #card.flash { animation: flash 1.4s ease-out; }
  @keyframes flash { from { box-shadow: 0 0 0 3px var(--read-tint); } to { box-shadow: 0 0 0 3px transparent; } }
  #main { padding: 10px 12px 14px 14px; box-sizing: border-box; }
  body.active #main { min-height: 150px; }

  #head { display: flex; align-items: center; gap: 4px; height: 28px; }
  #status { display: flex; align-items: center; gap: 8px; flex: 1; min-width: 0; font-size: 12px; }
  #status-text { font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
  .dot.read { background: var(--read); box-shadow: 0 0 0 3px var(--read-tint); animation: pulse 0.9s ease-in-out infinite; }
  .dot.dim { opacity: 0.45; }
  .dot.ring { background: transparent; box-shadow: inset 0 0 0 2px var(--accent); }
  .dot.off { background: var(--muted); opacity: 0.45; }
  @keyframes pulse { 50% { opacity: 0.4; } }

  #controls { display: none; align-items: center; gap: 4px; }
  body.active #controls { display: flex; }
  #pause .resume, body.paused #pause .pause { display: none; }
  body.paused #pause .resume { display: block; }
  body.user-turn #pause, body.user-turn #interrupt { display: none; }
  #speed-wrap { position: relative; }
  #speed { font-variant-numeric: tabular-nums; }
  #speed-menu {
    position: absolute; right: 0; top: 32px; z-index: 10; padding: 4px; border-radius: 6px;
    display: flex; flex-direction: column; background: var(--vscode-menu-background, var(--surface));
    color: var(--vscode-menu-foreground, var(--vscode-foreground));
    border: 1px solid var(--vscode-menu-border, var(--border)); box-shadow: 0 4px 14px rgba(0, 0, 0, 0.18);
  }
  #speed-menu[hidden] { display: none; }
  #speed-menu button { justify-content: flex-start; height: 24px; padding: 0 8px; color: inherit; font-variant-numeric: tabular-nums; }
  #speed-menu button[aria-checked="true"] { background: var(--soft-hover); font-weight: 600; }
  #speed-menu button:hover { background: var(--vscode-menu-selectionBackground, var(--soft)); color: var(--vscode-menu-selectionForeground, inherit); }

  #now { display: none; margin-top: 10px; }
  body.active #now { display: block; }
  #now-text { font-family: var(--narration); font-size: calc(var(--vscode-editor-font-size, 13px) * 1.45); line-height: 1.45; overflow-wrap: anywhere; }
  #now-text.empty { font-size: 13px; color: var(--muted); }
  #now-ref { margin-top: 8px; font-size: 12px; }
  #now-ref:empty { display: none; }
  #reading { height: 3px; margin-top: 12px; border-radius: 2px; visibility: hidden; background: var(--read-tint); }
  #reading.on { visibility: visible; }
  #reading-fill { height: 100%; width: 0; border-radius: 2px; background: var(--read); }
  #run { display: none; margin-top: 12px; }
  #run.on { display: block; }
  #run-label { font-size: 12px; color: var(--muted); margin-bottom: 6px; }
  #run-cmd { padding: 8px 10px; border-radius: 6px; background: var(--soft); font-family: var(--mono); font-size: 12.5px; white-space: pre-wrap; overflow-wrap: anywhere; }
  #run-cmd::before { content: "$ "; color: var(--muted); }
  #run-actions { display: none; flex-wrap: wrap; gap: 6px; margin-top: 10px; }
  #run.confirm #run-actions { display: flex; }

  #idle { margin-top: 10px; }
  body.active #idle { display: none; }
  #idle-title { font-size: 15px; font-weight: 600; }
  #idle-summary { margin-top: 6px; font-family: var(--narration); font-size: 14px; line-height: 1.5; }
  #idle-summary:empty { display: none; }
  #idle-text { margin-top: 4px; font-size: 12.5px; line-height: 1.5; color: var(--muted); }

  #composer { display: none; padding: 8px; border-top: 1px solid var(--border); border-radius: 0 0 9px 9px; background: var(--soft); }
  body.active #composer { display: block; }
  #compose-row {
    display: flex; align-items: flex-end; gap: 4px; padding: 3px 3px 3px 10px; border-radius: 8px;
    background: var(--surface); border: 1px solid var(--vscode-input-border, var(--border));
  }
  #compose-row:focus-within { border-color: var(--vscode-focusBorder); }
  #reply {
    flex: 1; min-width: 0; box-sizing: border-box; resize: none; border: none; outline: none; padding: 4px 0; margin: 0;
    font: inherit; font-size: 13px; line-height: 1.4; background: transparent; color: var(--vscode-input-foreground);
  }
  #reply::placeholder { color: var(--vscode-input-placeholderForeground); }
  #send { height: 24px; min-width: 24px; padding: 0 5px; }
  #attach { display: none; align-items: center; gap: 6px; margin: 0 2px 6px; font-size: 11.5px; color: var(--muted); }
  #attach.on { display: flex; }
  #attach-ref { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--mono); }
  #attach button { height: 18px; min-width: 18px; padding: 0 4px; font-size: 12px; }

  #history {
    flex: 1; overflow-y: auto; padding: 18px 14px 18px; display: flex; flex-direction: column; gap: 10px;
    font-size: 13px; color: var(--muted);
  }
  .entry { overflow-wrap: anywhere; line-height: 1.5; }
  .agent { font-family: var(--narration); }
  .speaker { font-family: var(--vscode-font-family); font-size: 11px; font-weight: 600; margin-bottom: 1px; }
  .you {
    align-self: flex-end; max-width: 85%; padding: 7px 11px; border-radius: 12px 12px 4px 12px;
    background: var(--you-tint); color: var(--vscode-foreground); font-family: var(--narration); line-height: 1.45;
  }
  .you .ref { display: block; margin-top: 4px; }
  .run {
    display: flex; align-items: center; gap: 7px; padding: 7px 10px; border-radius: 6px;
    background: var(--surface); border: 1px solid var(--border); font-size: 12px;
  }
  .run .cmd { font-family: var(--mono); color: var(--vscode-foreground); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .run .cmd::before { content: "$ "; color: var(--muted); }
  .run.skipped .cmd { color: var(--muted); }
  .run .outcome { margin-left: auto; flex: none; font-size: 11px; white-space: nowrap; }
  .run .outcome.ok { color: var(--ok); }
  .run .outcome.fail { color: var(--fail); }
  .divider { display: flex; align-items: center; gap: 8px; font-size: 11px; }
  .divider::before, .divider::after { content: ""; flex: 1; height: 1px; background: var(--border); }

  code { font-family: var(--mono); font-size: 0.88em; padding: 1px 4px; border-radius: 4px; background: var(--vscode-textCodeBlock-background); color: inherit; }
  a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  a:hover { text-decoration: underline; }
  a.file { font-family: var(--mono); font-size: 0.88em; text-decoration: underline dotted; text-underline-offset: 3px; }
  a.ref { font-family: var(--mono); font-size: 11.5px; }
</style>
</head>
<body>
<div id="app">
  <section id="card">
    <div id="main">
      <div id="head">
        <div id="status"><span id="dot" class="dot off"></span><span id="status-text">No session</span></div>
        <div id="controls">
          <button id="pause" class="quiet" aria-label="Pause" title="Pause (Space)" aria-keyshortcuts="Space">${ICONS.pause}${ICONS.resume}</button>
          <button id="interrupt" class="soft" aria-label="Interrupt" title="Interrupt">${ICONS.stop}</button>
          <button id="turn" class="soft" title="Take the turn: you drive, the agent navigates">${ICONS.swap}<span id="turn-label">My turn</span></button>
          <div id="speed-wrap">
            <button id="speed" class="quiet" aria-haspopup="menu" aria-expanded="false" title="Playback speed">1.0×</button>
            <div id="speed-menu" role="menu" aria-label="Playback speed" hidden>${speeds}</div>
          </div>
          <button id="end" class="quiet" aria-label="End the session" title="End the session">${ICONS.exit}</button>
        </div>
      </div>
      <div id="now">
        <div id="now-text" class="empty"></div>
        <div id="now-ref"></div>
        <div id="reading"><div id="reading-fill"></div></div>
        <div id="run">
          <div id="run-label"></div>
          <div id="run-cmd"></div>
          <div id="run-actions">
            <button id="run-go" class="primary">${ICONS.play}<span>Run</span></button>
            <button id="run-always" class="soft" title="Run it, and run exactly this command without asking until the session ends">Allow for session</button>
            <button id="run-skip" class="quiet">Skip</button>
          </div>
        </div>
      </div>
      <div id="idle">
        <div id="idle-title">No active session</div>
        <div id="idle-summary"></div>
        <div id="idle-text">Ask your agent to pair with you, or run <em>AI Pair: Play Demo Session</em>. First time? Run <em>AI Pair: Set Up Agent</em>.</div>
      </div>
    </div>
    <div id="composer">
      <div id="attach"><span>With selection</span><a id="attach-ref"></a><button id="attach-x" class="quiet" aria-label="Don't send the selection" title="Don't send the selection">×</button></div>
      <div id="compose-row">
        <textarea id="reply" rows="1" aria-label="Reply to the agent" placeholder="Reply to the agent…"></textarea>
        <button id="send" class="quiet" aria-label="Send" title="Send (Enter)">${ICONS.send}</button>
      </div>
    </div>
  </section>
  <section id="history" aria-label="Earlier, newest first"></section>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const ui = {
    card: $("card"), dot: $("dot"), status: $("status-text"), pause: $("pause"), interrupt: $("interrupt"),
    turn: $("turn"), turnLabel: $("turn-label"), speed: $("speed"), speedMenu: $("speed-menu"), end: $("end"),
    now: $("now-text"), ref: $("now-ref"), reading: $("reading"), fill: $("reading-fill"),
    idleTitle: $("idle-title"), idleSummary: $("idle-summary"), idleText: $("idle-text"),
    reply: $("reply"), send: $("send"), attach: $("attach"), attachRef: $("attach-ref"), attachX: $("attach-x"),
    run: $("run"), runLabel: $("run-label"), runCmd: $("run-cmd"), runGo: $("run-go"), runAlways: $("run-always"), runSkip: $("run-skip"),
    history: $("history"),
  };
  let active = false, turn = "agent", paused = false, replaying = false;
  let state = null;     // the agent's state, as the extension last reported it
  let selection = null, selectionDismissed = false;   // the programmer's selection, offered with the reply
  let runId = null, runConfirming = false;   // the command shown in the run box
  let current = null;   // text of the current message
  let reading = null;   // { ms, elapsed, last }
  let pointed = null;   // a link to the code the agent just pointed at, shown with the message about it

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  // A code span that names a file, like \`game.ts\` or \`src/game.ts\`, becomes a link that opens it.
  const FILE = /^[\\w@.~-]*(\\/[\\w@.~-]+)*\\.(ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|css|scss|less|html|vue|svelte|py|rs|go|java|kt|swift|c|h|cc|cpp|hpp|cs|rb|php|lua|sh|zsh|toml|yaml|yml|xml|sql|txt|lock|env)$/;
  const URL = /\\bhttps?:\\/\\/[^\\s<>"'\`]*[^\\s<>"'\`.,;:!?)\\]]/g;
  const codeSpan = (code) =>
    FILE.test(code) && !code.startsWith(".") ? '<a class="file" data-file="' + code + '">' + code + "</a>" : "<code>" + code + "</code>";
  const rich = (s) => esc(s).split(/(\`[^\`]+\`)/).map((part, i) =>
    i % 2 === 1 ? codeSpan(part.slice(1, -1)) : part.replace(URL, (u) => '<a class="url" data-url="' + u + '">' + u + "</a>")).join("");
  const DEFAULT_IDLE = ui.idleText.innerHTML;

  function add(el) {
    ui.history.prepend(el);
    return el;
  }

  function entry(cls, html) {
    const el = document.createElement("div");
    el.className = "entry " + cls;
    if (html !== undefined) el.innerHTML = html;
    return el;
  }

  function addAgent(html) {
    // One "Agent" label per run of the agent's messages, above the newest.
    const top = ui.history.firstElementChild;
    if (top && top.classList.contains("agent")) top.querySelector(".speaker")?.remove();
    const el = entry("agent", html);
    const who = document.createElement("div");
    who.className = "speaker";
    who.textContent = "Agent";
    el.prepend(who);
    add(el);
  }

  function addDivider(text) { add(entry("divider")).textContent = text; }

  function refLink(ref) {
    const a = document.createElement("a");
    a.className = "ref";
    a.textContent = ref.file + ":" + ref.line + (ref.endLine > ref.line ? "–" + ref.endLine : "");
    a.onclick = () => vscode.postMessage({ type: "open", file: ref.file, line: ref.line });
    return a;
  }

  function addYou(text, ref) {
    const el = entry("you", text ? rich(text) : "");
    if (ref) el.append(refLink(ref));
    add(el);
  }

  function addRun(command, phase, exitCode) {
    const el = entry("run");
    const cmd = document.createElement("span");
    cmd.className = "cmd";
    cmd.textContent = command;
    cmd.title = command;
    const outcome = document.createElement("span");
    outcome.className = "outcome";
    if (phase === "declined") { el.classList.add("skipped"); outcome.textContent = "⊘ skipped"; }
    else if (phase === "background") outcome.textContent = "still running";
    else if (exitCode === undefined) outcome.textContent = "done";
    else if (exitCode === 0) { outcome.classList.add("ok"); outcome.textContent = "✓ exit 0"; }
    else { outcome.classList.add("fail"); outcome.textContent = "✕ exit " + exitCode; }
    el.append(cmd, outcome);
    add(el);
  }

  const attaching = () => active && selection !== null && !selectionDismissed;
  function syncAttach() {
    ui.attach.classList.toggle("on", attaching());
    if (attaching()) ui.attachRef.replaceChildren(refLink(selection));
  }

  function flash() {
    if (replaying) return;
    ui.card.classList.remove("flash");
    void ui.card.offsetWidth;
    ui.card.classList.add("flash");
  }

  function setNow(text) {
    if (current !== null) addAgent(rich(current));
    current = text;
    ui.now.className = "";
    ui.now.innerHTML = rich(text);
    // The agent points first, then says what's there.
    ui.ref.replaceChildren(...(pointed ? [pointed] : []));
    pointed = null;
    flash();
  }

  function startReading(ms) {
    if (replaying) return;
    reading = { ms, elapsed: 0, last: performance.now() };
    ui.fill.style.width = "0";
    ui.reading.classList.add("on");
    requestAnimationFrame(tick);
  }

  function tick(t) {
    if (!reading) return;
    if (!paused) reading.elapsed += t - reading.last;
    reading.last = t;
    const f = Math.min(1, reading.elapsed / reading.ms);
    ui.fill.style.width = (f * 100) + "%";
    if (f >= 1) { reading = null; ui.reading.classList.remove("on"); return; }
    requestAnimationFrame(tick);
  }

  const STATUS = {
    typing: ["", "Agent is typing"],
    read: ["read", "Read this"],
    running: ["", "Running a command"],
    thinking: ["dim", "Agent is thinking"],
    paused: ["dim", "Paused"],
    listening: ["ring", "Your move"],
    navigator: ["ring", "Your turn · navigating"],
  };

  function syncStatus() {
    if (!active) {
      ui.dot.className = "dot off";
      ui.status.textContent = "No session";
      return;
    }
    const [cls, text] = runConfirming ? ["read", "Needs you"] : STATUS[state] || ["", "Session started"];
    ui.dot.className = "dot " + cls;
    ui.status.textContent = text;
  }

  function setState(e) {
    state = e.state; turn = e.turn; paused = e.paused;
    document.body.classList.toggle("paused", paused);
    document.body.classList.toggle("user-turn", turn === "user");
    ui.pause.classList.toggle("on", paused);
    ui.pause.setAttribute("aria-label", paused ? "Resume" : "Pause");
    ui.pause.title = paused ? "Resume (Space)" : "Pause (Space)";
    ui.turnLabel.textContent = turn === "user" ? "Hand back" : "My turn";
    ui.turn.title = turn === "user" ? "Hand the turn back to the agent, with your reply if you typed one" : "Take the turn: you drive, the agent navigates";
    syncStatus();
  }

  function setActive(on) {
    active = on;
    document.body.classList.toggle("active", on);
    ui.reply.disabled = !on;
    if (!on) {
      reading = null; ui.reading.classList.remove("on");
      runId = null; runConfirming = false; ui.run.className = "";
      closeSpeedMenu();
    }
    syncStatus();
    syncAttach();
  }

  function handle(e) {
    switch (e.type) {
      case "replay":
        replaying = true;
        for (const ev of e.events) handle(ev);
        replaying = false;
        return;
      case "session":
        if (e.active) {
          if (current !== null) addAgent(rich(current));
          current = null;
          state = null;
          ui.now.className = "empty";
          ui.now.textContent = "Waiting for the agent…";
          ui.ref.innerHTML = "";
          pointed = null;
          addDivider("Session started" + (e.task ? ": " + e.task : ""));
          setActive(true);
        } else {
          if (current !== null) addAgent(rich(current));
          current = null;
          const why = { agent: "The agent ended the session", user: "You ended the session", disconnected: "The agent disconnected" }[e.reason];
          addDivider(why);
          ui.idleTitle.textContent = e.reason === "disconnected" ? "The agent disconnected" : "Session ended";
          ui.idleSummary.innerHTML = e.summary ? rich(e.summary) : "";
          ui.idleText.innerHTML = "Ask your agent to pair again, or run <em>AI Pair: Play Demo Session</em>.";
          setActive(false);
        }
        return;
      case "say": setNow(e.text); return;
      case "reading": startReading(e.ms); return;
      case "state": setState(e); return;
      case "user": addYou(e.text, e.ref); return;
      case "interrupt": addDivider("You interrupted"); return;
      case "turn":
        addDivider(e.to === "user" ? "You took the turn" : "You handed the turn back");
        if (e.message || e.ref) addYou(e.message, e.ref);
        ui.reply.placeholder = e.to === "user" ? "Ask the agent…" : "Reply to the agent…";
        return;
      case "point": {
        const a = document.createElement("a");
        a.className = "ref";
        a.textContent = "→ " + e.file + ":" + e.line;
        a.onclick = () => vscode.postMessage({ type: "open", file: e.file, line: e.line });
        pointed = a;
        return;
      }
      case "run": {
        if (e.phase === "confirm" || e.phase === "running") {
          runId = e.id;
          runConfirming = e.phase === "confirm";
          ui.run.className = "on" + (runConfirming ? " confirm" : "");
          ui.runLabel.textContent = runConfirming ? "Allow this command in the terminal?" : "Running in the terminal…";
          ui.runCmd.textContent = e.command;
          syncStatus();
          if (runConfirming) flash();
          return;
        }
        if (runId === e.id) { runId = null; runConfirming = false; ui.run.className = ""; syncStatus(); }
        addRun(e.command, e.phase, e.exitCode);
        return;
      }
      case "selection":
        selection = e.ref || null;
        selectionDismissed = false;
        syncAttach();
        return;
      case "focusReply": ui.reply.focus(); return;
      case "speed": {
        // One decimal, so the menu's speeds line up; a setting with more keeps them.
        const label = (Number.isInteger(e.value * 10) ? e.value.toFixed(1) : String(e.value)) + "×";
        ui.speed.textContent = label;
        ui.speed.setAttribute("aria-label", "Playback speed: " + label);
        for (const b of ui.speedMenu.querySelectorAll("button")) {
          b.setAttribute("aria-checked", String(Math.abs(Number(b.dataset.speed) - e.value) < 0.01));
        }
        return;
      }
    }
  }

  window.addEventListener("message", (m) => handle(m.data));

  let draftEmpty = true;
  function syncDraft() {
    const empty = ui.reply.value.trim() === "";
    ui.reply.style.height = "auto";
    ui.reply.style.height = Math.min(ui.reply.scrollHeight, 120) + "px";
    if (empty !== draftEmpty) { draftEmpty = empty; vscode.postMessage({ type: "draft", empty }); }
  }
  function takeDraft() {
    const text = ui.reply.value.trim();
    ui.reply.value = "";
    draftEmpty = true;
    syncDraft();
    return text;
  }
  function takeAttach() {
    const on = attaching();
    if (on) { selectionDismissed = true; syncAttach(); }
    return on;
  }
  function sendReply() {
    const text = takeDraft();
    if (text) vscode.postMessage({ type: "reply", text, attach: takeAttach() });
  }

  ui.reply.addEventListener("input", syncDraft);
  ui.reply.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      sendReply();
    } else if (e.key === "Escape") {
      ui.reply.blur();
    }
  });
  ui.send.onclick = sendReply;
  ui.pause.onclick = () => vscode.postMessage({ type: paused ? "resume" : "pause" });
  ui.interrupt.onclick = () => vscode.postMessage({ type: "interrupt" });
  ui.turn.onclick = () => {
    const handingBack = turn === "user";
    const message = handingBack ? takeDraft() : "";
    const attach = handingBack && takeAttach();
    vscode.postMessage({ type: "turn", ...(message ? { message } : {}), ...(attach ? { attach } : {}) });
  };
  ui.attachX.onclick = () => { selectionDismissed = true; syncAttach(); };
  const decide = (run, remember) => { if (runId !== null) vscode.postMessage({ type: "runDecision", id: runId, run, remember }); };
  ui.runGo.onclick = () => decide(true, false);
  ui.runAlways.onclick = () => decide(true, true);
  ui.runSkip.onclick = () => decide(false, false);
  ui.end.onclick = () => vscode.postMessage({ type: "end" });

  function closeSpeedMenu() {
    ui.speedMenu.hidden = true;
    ui.speed.setAttribute("aria-expanded", "false");
    ui.speed.classList.remove("on");
  }
  ui.speed.onclick = (e) => {
    e.stopPropagation();
    const open = ui.speedMenu.hidden;
    ui.speedMenu.hidden = !open;
    ui.speed.setAttribute("aria-expanded", String(open));
    ui.speed.classList.toggle("on", open);
    if (open) ui.speedMenu.querySelector('[aria-checked="true"]')?.focus();
  };
  for (const b of ui.speedMenu.querySelectorAll("button")) {
    b.onclick = () => { closeSpeedMenu(); ui.speed.focus(); vscode.postMessage({ type: "speed", value: Number(b.dataset.speed) }); };
  }
  document.addEventListener("click", (e) => { if (!ui.speedMenu.hidden && !ui.speedMenu.contains(e.target)) closeSpeedMenu(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ui.speedMenu.hidden) { closeSpeedMenu(); ui.speed.focus(); } });

  // Space pauses and resumes, anywhere in the panel but the reply box. It doesn't press the focused
  // button, which after a click could be End; Enter still does.
  document.addEventListener("keydown", (e) => {
    if (e.key !== " " || e.ctrlKey || e.metaKey || e.altKey || !active) return;
    if (e.target === ui.reply) return;
    e.preventDefault();
    if (e.repeat || turn === "user") return;
    vscode.postMessage({ type: paused ? "resume" : "pause" });
  });

  // File names in messages open the file, and URLs open in the browser.
  document.addEventListener("click", (e) => {
    const a = e.target.closest && e.target.closest("a.file, a.url");
    if (a?.dataset.file) vscode.postMessage({ type: "openFile", file: a.dataset.file });
    if (a?.dataset.url) vscode.postMessage({ type: "openUrl", url: a.dataset.url });
  });

  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`
}

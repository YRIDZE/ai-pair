// The narration panel's page. Layout, top to bottom: controls and reply box, the current
// message (top edge fixed, grows downward), the reading-pause bar, then history, newest first.

import { randomBytes } from "node:crypto"

export function panelHtml(cspSource: string): string {
  const nonce = randomBytes(16).toString("base64")
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
  }
  html, body { height: 100%; margin: 0; padding: 0; }
  body {
    font-family: var(--vscode-font-family);
    font-size: var(--vscode-font-size, 13px);
    color: var(--vscode-foreground);
  }
  #app { display: flex; flex-direction: column; height: 100%; }

  header { flex: none; padding: 10px 12px 10px; border-bottom: 1px solid var(--vscode-sideBarSectionHeader-border, transparent); }
  .row { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  #status-row { display: flex; align-items: center; justify-content: space-between; gap: 8px; margin-bottom: 8px; }
  #status { display: flex; align-items: center; gap: 7px; min-width: 0; font-size: 12px; color: var(--vscode-descriptionForeground); white-space: nowrap; overflow: hidden; }
  #status-text { overflow: hidden; text-overflow: ellipsis; }
  #speed { display: flex; flex: none; border-radius: 3px; overflow: hidden; border: 1px solid var(--vscode-button-border, rgba(128, 128, 128, 0.3)); }
  #speed button { border: none; border-radius: 0; padding: 1px 7px; font-size: 11px; background: transparent; color: var(--vscode-descriptionForeground); }
  #speed button.on { background: var(--vscode-button-background); color: var(--vscode-button-foreground); }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--accent); flex: none; }
  .dot.read { background: var(--read); animation: pulse 0.9s ease-in-out infinite; }
  .dot.dim { opacity: 0.4; }
  .dot.ring { background: transparent; box-shadow: inset 0 0 0 2px var(--accent); }
  .dot.off { background: var(--vscode-descriptionForeground); opacity: 0.4; }
  @keyframes pulse { 50% { opacity: 0.35; } }

  button {
    font: inherit; font-size: 12px; padding: 2px 9px; border-radius: 3px; cursor: pointer;
    border: 1px solid var(--vscode-button-border, transparent);
    background: var(--vscode-button-secondaryBackground);
    color: var(--vscode-button-secondaryForeground);
  }
  button:hover:not(:disabled) { background: var(--vscode-button-secondaryHoverBackground); }
  button:disabled { opacity: 0.45; cursor: default; }

  #reply {
    display: block; width: 100%; box-sizing: border-box; margin-top: 9px; resize: none;
    font: inherit; font-size: 13px; line-height: 1.4; padding: 4px 8px; border-radius: 3px;
    color: var(--vscode-input-foreground); background: transparent;
    border: 1px solid var(--vscode-input-border, rgba(128, 128, 128, 0.22));
    opacity: 0.65;
  }
  #reply:focus, #reply.has-text {
    opacity: 1; outline: none;
    background: var(--vscode-input-background);
    border-color: var(--vscode-focusBorder);
  }
  #reply::placeholder { color: var(--vscode-input-placeholderForeground); }

  #now { flex: none; padding: 16px 14px 0; }
  #now-text {
    font-size: calc(var(--vscode-editor-font-size, 13px) * 1.4);
    line-height: 1.45; padding: 3px 0 3px 12px;
    border-left: 3px solid var(--accent); border-radius: 2px;
    overflow-wrap: anywhere;
  }
  #now-text.empty { border-left-color: transparent; font-size: 13px; color: var(--vscode-descriptionForeground); }
  #now-text.flash { animation: flash 1.4s ease-out; }
  @keyframes flash { from { background: color-mix(in srgb, var(--read) 24%, transparent); } to { background: transparent; } }
  #now-ref { margin: 6px 0 0 15px; font-size: 12px; min-height: 0; }
  #reading { height: 3px; margin: 10px 0 0 15px; border-radius: 2px; visibility: hidden; background: color-mix(in srgb, var(--read) 18%, transparent); }
  #reading.on { visibility: visible; }
  #reading-fill { height: 100%; width: 0; border-radius: 2px; background: var(--read); }

  #history { flex: 1; overflow-y: auto; padding: 14px 14px 18px; font-size: 12.5px; color: var(--vscode-descriptionForeground); }
  .entry { padding: 5px 0; line-height: 1.45; overflow-wrap: anywhere; }
  .entry.you { color: var(--vscode-foreground); }
  .entry.you::before { content: "You: "; font-weight: 600; }
  .entry.note { font-style: italic; opacity: 0.8; }
  .entry.divider { text-align: center; opacity: 0.6; font-size: 11px; padding: 10px 0; }

  code { font-family: var(--vscode-editor-font-family); font-size: 0.9em; padding: 0 3px; border-radius: 3px; background: var(--vscode-textCodeBlock-background); }
  a { color: var(--vscode-textLink-foreground); cursor: pointer; text-decoration: none; }
  a:hover { text-decoration: underline; }
</style>
</head>
<body>
<div id="app">
  <header>
    <div id="status-row">
      <div id="status"><span id="dot" class="dot off"></span><span id="status-text">No session</span></div>
      <div id="speed" title="Playback speed">
        <button data-speed="0.6">Slow</button><button data-speed="1">Normal</button><button data-speed="1.6">Fast</button>
      </div>
    </div>
    <div class="row">
      <button id="pause" disabled>Pause</button>
      <button id="interrupt" disabled>Interrupt</button>
      <button id="turn" disabled title="Take the turn: you drive, the agent navigates">My turn</button>
      <button id="end" disabled title="End the session">End</button>
    </div>
    <textarea id="reply" rows="1" placeholder="Reply to the agent… (Enter to send)" disabled></textarea>
  </header>
  <section id="now">
    <div id="now-text" class="empty">No active session. Ask your agent to pair with you, or run <em>AI Pair: Play Demo Session</em>. First time? Run <em>AI Pair: Set Up Agent</em>.</div>
    <div id="now-ref"></div>
    <div id="reading"><div id="reading-fill"></div></div>
  </section>
  <section id="history"></section>
</div>
<script nonce="${nonce}">
  const vscode = acquireVsCodeApi();
  const $ = (id) => document.getElementById(id);
  const ui = {
    dot: $("dot"), status: $("status-text"), pause: $("pause"), interrupt: $("interrupt"),
    turn: $("turn"), end: $("end"), reply: $("reply"), now: $("now-text"), ref: $("now-ref"),
    reading: $("reading"), fill: $("reading-fill"), history: $("history"),
  };
  let active = false, turn = "agent", paused = false, replaying = false;
  let current = null;   // text of the current message
  let reading = null;   // { ms, elapsed, last }

  const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const rich = (s) => esc(s).replace(/\`([^\`]+)\`/g, "<code>$1</code>");

  function addHistory(html, kind) {
    const el = document.createElement("div");
    el.className = "entry" + (kind ? " " + kind : "");
    el.innerHTML = html;
    ui.history.prepend(el);
  }

  function setNow(text) {
    if (current !== null) addHistory(rich(current));
    current = text;
    ui.now.className = "";
    ui.now.innerHTML = rich(text);
    ui.ref.innerHTML = "";
    if (!replaying) { void ui.now.offsetWidth; ui.now.classList.add("flash"); }
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
    thinking: ["dim", "Agent is thinking"],
    paused: ["dim", "Paused"],
    listening: ["ring", "Your move"],
    navigator: ["ring", "Your turn · agent navigating"],
  };

  function setState(e) {
    turn = e.turn; paused = e.paused;
    const [cls, text] = STATUS[e.state] || ["", e.state];
    ui.dot.className = "dot " + cls;
    ui.status.textContent = text;
    ui.pause.textContent = paused ? "Resume" : "Pause";
    ui.turn.textContent = turn === "user" ? "Your turn" : "My turn";
    ui.turn.title = turn === "user" ? "Hand the turn back to the agent (with your reply, if any)" : "Take the turn: you drive, the agent navigates";
    ui.pause.disabled = turn === "user";
    ui.interrupt.disabled = turn === "user";
  }

  function setActive(on) {
    active = on;
    for (const b of [ui.pause, ui.interrupt, ui.turn, ui.end, ui.reply]) b.disabled = !on;
    if (!on) {
      ui.dot.className = "dot off";
      ui.status.textContent = "No session";
      reading = null; ui.reading.classList.remove("on");
    }
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
          if (current !== null) addHistory(rich(current));
          current = null;
          ui.now.className = "empty";
          ui.now.textContent = "Session started. Waiting for the agent…";
          ui.ref.innerHTML = "";
          addHistory("Session started" + (e.task ? ": " + rich(e.task) : ""), "divider");
          setActive(true);
        } else {
          if (e.summary) setNow(e.summary);
          const why = { agent: "Session ended", user: "You ended the session", disconnected: "The agent disconnected" }[e.reason];
          addHistory(why, "divider");
          setActive(false);
        }
        return;
      case "say": setNow(e.text); return;
      case "reading": startReading(e.ms); return;
      case "state": setState(e); return;
      case "user": addHistory(rich(e.text), "you"); return;
      case "interrupt": addHistory("You interrupted.", "note"); return;
      case "turn":
        addHistory(e.to === "user" ? "You took the turn." : "You handed the turn back.", "note");
        if (e.message) addHistory(rich(e.message), "you");
        ui.reply.placeholder = e.to === "user" ? "Ask the agent… (Enter to send)" : "Reply to the agent… (Enter to send)";
        return;
      case "point": {
        const a = document.createElement("a");
        a.textContent = e.file + ":" + e.line;
        a.onclick = () => vscode.postMessage({ type: "open", file: e.file, line: e.line });
        ui.ref.replaceChildren(a);
        return;
      }
      case "focusReply": ui.reply.focus(); return;
      case "speed":
        for (const b of document.querySelectorAll("#speed button")) {
          b.classList.toggle("on", Math.abs(Number(b.dataset.speed) - e.value) < 0.01);
        }
        return;
    }
  }

  window.addEventListener("message", (m) => handle(m.data));

  let draftEmpty = true;
  function syncDraft() {
    const empty = ui.reply.value.trim() === "";
    ui.reply.classList.toggle("has-text", !empty);
    ui.reply.style.height = "auto";
    ui.reply.style.height = Math.min(ui.reply.scrollHeight + 2, 120) + "px";
    if (empty !== draftEmpty) { draftEmpty = empty; vscode.postMessage({ type: "draft", empty }); }
  }
  function takeDraft() {
    const text = ui.reply.value.trim();
    ui.reply.value = "";
    draftEmpty = true;
    syncDraft();
    return text;
  }

  ui.reply.addEventListener("input", syncDraft);
  ui.reply.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      const text = takeDraft();
      if (text) vscode.postMessage({ type: "reply", text });
    } else if (e.key === "Escape") {
      ui.reply.blur();
    }
  });
  ui.pause.onclick = () => vscode.postMessage({ type: paused ? "resume" : "pause" });
  ui.interrupt.onclick = () => vscode.postMessage({ type: "interrupt" });
  ui.turn.onclick = () => {
    const message = turn === "user" ? takeDraft() : "";
    vscode.postMessage(message ? { type: "turn", message } : { type: "turn" });
  };
  ui.end.onclick = () => vscode.postMessage({ type: "end" });
  for (const b of document.querySelectorAll("#speed button")) {
    b.onclick = () => vscode.postMessage({ type: "speed", value: Number(b.dataset.speed) });
  }

  vscode.postMessage({ type: "ready" });
</script>
</body>
</html>`
}

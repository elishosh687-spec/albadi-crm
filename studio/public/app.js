// Bag Studio — frontend. Talks to the local server; streams the Claude chat
// over a fetch/ReadableStream SSE parse (EventSource is GET-only).

const $ = (id) => document.getElementById(id);
const state = {
  sessionKey: "adhoc",      // work-dir key (dealId when a deal is loaded)
  claudeSessionId: null,    // Claude conversation id (for multi-turn resume)
  dealId: null,
  leadSid: null,
  customerName: null,
  logoName: null,
  dielineName: null,
  busy: false,
};

function addMsg(cls, text) {
  const d = document.createElement("div");
  d.className = "m " + cls;
  d.textContent = text;
  $("msgs").appendChild(d);
  $("msgs").scrollTop = $("msgs").scrollHeight;
  return d;
}

async function loadDeal() {
  const dealId = $("dealId").value.trim();
  if (!dealId) { addMsg("ai", "אין מזהה עסקה — נמשיך במצב ליד חופשי. תאר לי את התיק ואעלה לוגו."); return; }
  try {
    const r = await fetch("/api/deal?dealId=" + encodeURIComponent(dealId));
    const j = await r.json();
    if (!j.ok) { addMsg("err", "טעינה נכשלה: " + (j.error || r.status)); return; }
    state.dealId = dealId;
    state.sessionKey = j.sessionKey;
    state.leadSid = j.brief.leadSid;
    state.customerName = j.brief.customerName;
    state.claudeSessionId = null; // fresh conversation per deal
    const chip = $("custChip");
    chip.style.display = "";
    chip.textContent = "עסקה · " + (j.brief.customerName || dealId) + (j.brief.leadSid ? "" : " · אין ליד לשליחה");
    addMsg("ai", "טענתי את הבריף:\n" + j.briefText + "\n\nמה נעשה — הדמיה או פריסה?");
    refreshOutputs();
  } catch (e) { addMsg("err", String(e)); }
}

async function refreshOutputs() {
  const r = await fetch("/api/outputs?session=" + encodeURIComponent(state.sessionKey));
  const j = await r.json();
  renderResults(j.files || []);
}

function isImg(n){return /\.(png|jpe?g|webp)$/i.test(n)}
function isVid(n){return /\.(mp4|webm|mov)$/i.test(n)}

function renderResults(files) {
  const box = $("results");
  box.innerHTML = "";
  $("noRes").style.display = files.length ? "none" : "";
  for (const f of files) {
    const fileUrl = "/api/file?session=" + encodeURIComponent(state.sessionKey) + "&name=" + encodeURIComponent(f.name);
    const card = document.createElement("div");
    card.className = "res";
    const thumb = isImg(f.name)
      ? `<img class="thumb" src="${fileUrl}" alt="">`
      : `<div class="thumb">${isVid(f.name) ? "וידאו" : (f.name.split(".").pop()||"").toUpperCase()}</div>`;
    const waBtn = state.leadSid ? `<button class="btn wa" data-wa="${f.name}">שלח ללקוח</button>` : "";
    const stage = /\.(pdf)$/i.test(f.name) ? "layout" : "mockup";
    const pushBtn = state.dealId ? `<button class="btn" data-push="${f.name}" data-stage="${stage}">לתיק</button>` : "";
    card.innerHTML = `
      <div class="top">${thumb}<div><div class="nm">${f.name}</div>
        <div class="hint"><a href="${fileUrl}" target="_blank">פתח</a></div></div></div>
      <div class="row">${waBtn}${pushBtn}</div>`;
    box.appendChild(card);
  }
  box.querySelectorAll("[data-wa]").forEach((b) => b.onclick = () => sendWa(b.getAttribute("data-wa"), b));
  box.querySelectorAll("[data-push]").forEach((b) => b.onclick = () => pushToDeal(b.getAttribute("data-push"), b.getAttribute("data-stage"), b));
}

async function sendWa(name, btn) {
  if (!state.leadSid) return;
  btn.disabled = true; btn.textContent = "שולח…";
  try {
    const r = await fetch("/api/whatsapp", { method: "POST", headers: {"content-type":"application/json"},
      body: JSON.stringify({ leadSid: state.leadSid, session: state.sessionKey, name }) });
    const j = await r.json();
    btn.textContent = j.ok ? "נשלח ✓" : "שגיאה";
    if (!j.ok) { alert("שליחה נכשלה: " + (j.error||"")); btn.disabled = false; btn.textContent = "שלח ללקוח"; }
  } catch (e) { alert(String(e)); btn.disabled = false; btn.textContent = "שלח ללקוח"; }
}

async function pushToDeal(name, stage, btn) {
  if (!state.dealId) return;
  btn.disabled = true; btn.textContent = "מעלה…";
  try {
    const r = await fetch("/api/push", { method: "POST", headers: {"content-type":"application/json"},
      body: JSON.stringify({ dealId: state.dealId, stage, session: state.sessionKey, name }) });
    const j = await r.json();
    btn.textContent = j.ok ? "בתיק ✓" : "שגיאה";
    if (!j.ok) { alert("העלאה נכשלה: " + (j.error||"")); btn.disabled = false; btn.textContent = "לתיק"; }
  } catch (e) { alert(String(e)); btn.disabled = false; btn.textContent = "לתיק"; }
}

async function uploadFile(file) {
  const r = await fetch("/api/upload?session=" + encodeURIComponent(state.sessionKey), {
    method: "POST", headers: { "x-filename": file.name }, body: file });
  const j = await r.json();
  if (!j.ok) throw new Error(j.error || "upload failed");
  return j.name;
}

async function sendChat(message) {
  if (state.busy || !message.trim()) return;
  state.busy = true; $("sendBtn").disabled = true;
  addMsg("me", message);
  $("input").value = "";
  let aiEl = null;
  try {
    const r = await fetch("/api/chat", { method: "POST", headers: {"content-type":"application/json"},
      body: JSON.stringify({ message, sessionKey: state.sessionKey, claudeSessionId: state.claudeSessionId }) });
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split("\n\n");
      buf = parts.pop() || "";
      for (const part of parts) {
        const line = part.replace(/^data: /, "").trim();
        if (!line) continue;
        let ev; try { ev = JSON.parse(line); } catch { continue; }
        if (ev.kind === "text") { aiEl = aiEl && aiEl.classList.contains("ai") ? aiEl : addMsg("ai",""); aiEl.textContent += ev.text; $("msgs").scrollTop = $("msgs").scrollHeight; }
        else if (ev.kind === "tool") { addMsg("tool", "⚙ " + ev.label); aiEl = null; }
        else if (ev.kind === "error") { addMsg("err", ev.error); }
        else if (ev.kind === "done") { if (ev.sessionId) state.claudeSessionId = ev.sessionId; renderResults(ev.allFiles || []); }
      }
    }
  } catch (e) { addMsg("err", String(e)); }
  finally { state.busy = false; $("sendBtn").disabled = false; }
}

async function makeDieline() {
  if (!state.logoName || !state.dielineName) { alert("העלה קודם לוגו + פריסת מפעל"); return; }
  sendChat(`יש בתיקייה שני קבצים: לוגו="${state.logoName}" ופריסת מפעל="${state.dielineName}". הרץ את סקיל dieline-print (produce.py) עם --logo ו--dieline, ושמור את קובץ ההפקה כ-PDF בתיקייה.`);
}

// wiring
$("loadBtn").onclick = loadDeal;
$("dealId").addEventListener("keydown", (e) => { if (e.key === "Enter") loadDeal(); });
$("sendBtn").onclick = () => sendChat($("input").value);
$("input").addEventListener("keydown", (e) => { if (e.key === "Enter") sendChat($("input").value); });
$("dielineBtn").onclick = makeDieline;

function wireDrop(dropId, inputId, which) {
  const drop = $(dropId), input = $(inputId);
  drop.onclick = () => input.click();
  input.onchange = async () => {
    if (!input.files[0]) return;
    try {
      const name = await uploadFile(input.files[0]);
      if (which === "logo") state.logoName = name; else state.dielineName = name;
      drop.classList.add("has");
      drop.firstChild.textContent = (which === "logo" ? "לוגו ✓ " : "פריסה ✓ ") + name;
      refreshOutputs();
    } catch (e) { alert(String(e)); }
  };
}
wireDrop("logoDrop", "logoFile", "logo");
wireDrop("dielineDrop", "dielineFile", "dieline");

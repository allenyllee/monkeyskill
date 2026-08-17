import { readFile } from "node:fs/promises";
import http from "node:http";

const [sessionId, rawPort = "4181"] = process.argv.slice(2);
if (!sessionId) throw new Error("Usage: node scripts/diagnose-overlay.mjs <builder-session-id> [port]");
const port = Number(rawPort);
if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error("Invalid port.");

const bootstrap = JSON.parse(await readFile(".tmp-clean-agent-bootstrap.json", "utf8"));
const response = await fetch(`http://127.0.0.1:8788/sessions/${encodeURIComponent(sessionId)}`, {
  headers: { authorization: `Bearer ${bootstrap.token}` }
});
if (!response.ok) throw new Error(`Session fetch failed: HTTP ${response.status}`);
const session = await response.json();
const lastAssistant = [...session.turns].reverse().find(turn => turn.role === "assistant");
if (!lastAssistant || typeof lastAssistant.content !== "string") throw new Error("Session has no Builder completion.");
const candidate = JSON.parse(lastAssistant.content);
const candidateCode = candidate.modes?.absolute?.js;
if (typeof candidateCode !== "string") throw new Error("Builder completion has no Absolute JavaScript.");

const manualCode = String.raw`(() => {
  const pointerTargets = "canvas,img,input,textarea,select,button,video,svg,[contenteditable]:not([contenteditable='false'])";
  const emptyOverlay = element => !element.matches(pointerTargets + ",a,label,option")
    && !element.textContent.trim()
    && !element.querySelector(pointerTargets);
  const visualBackground = element => {
    const style = getComputedStyle(element);
    return style.backgroundImage !== "none"
      || !["rgba(0, 0, 0, 0)", "transparent"].includes(style.backgroundColor);
  };
  const repair = root => {
    const all = [...root.querySelectorAll("body *")];
    const targets = all.filter(element => element.matches(pointerTargets) || visualBackground(element));
    const overlays = all.filter(emptyOverlay);
    for (const target of targets) {
      const rect = target.getBoundingClientRect();
      if (!rect.width || !rect.height) continue;
      const hit = document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2);
      if (!hit || hit === target || target.contains(hit) || hit.contains(target) || !overlays.includes(hit)) continue;
      const other = hit.getBoundingClientRect();
      if (rect.right > other.left && rect.left < other.right && rect.bottom > other.top && rect.top < other.bottom) {
        hit.style.setProperty("pointer-events", "none", "important");
      }
    }
  };
  repair(document);
})();`;

function page(code, label) {
  const serializedCode = JSON.stringify(code).replaceAll("<", "\\u003c");
  return `<!doctype html>
<html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${label} overlay diagnostic</title><style>
body{margin:24px;font:15px/1.5 system-ui,sans-serif;background:#f5f7fb;color:#152033}
.grid{display:grid;grid-template-columns:repeat(2,260px);gap:24px;margin:24px 0}.case{background:#fff;padding:10px;border:1px solid #c7d0df}.wrap{position:relative;width:240px;height:120px}.target,.overlay{position:absolute!important;left:8px!important;top:8px!important;width:240px!important;height:120px!important;box-sizing:border-box!important}.target{background:rgb(20,40,60);color:#fff}.overlay{z-index:10!important;pointer-events:auto;background:rgba(255,0,0,.12)}pre{padding:14px;background:#111827;color:#d1fae5;white-space:pre-wrap}
</style></head><body><h1>${label}</h1><div class="grid">
<section class="case" data-case="canvas"><b>canvas</b><div class="wrap"><canvas class="target"></canvas><div class="overlay"></div></div></section>
<section class="case" data-case="image"><b>image</b><div class="wrap"><img class="target" alt="image"><div class="overlay"></div></div></section>
<section class="case" data-case="input"><b>input</b><div class="wrap"><input class="target" value="input"><div class="overlay"></div></div></section>
<section class="case" data-case="background"><b>background</b><div class="wrap"><div class="target">background</div><div class="overlay"></div></div></section>
</div><pre id="result">running…</pre><script>
const hitState=section=>{const target=section.querySelector('.target');const rect=target.getBoundingClientRect();const hit=document.elementFromPoint(rect.left+rect.width/2,rect.top+rect.height/2);return{case:section.dataset.case,pass:hit===target||target.contains(hit),hit:hit?.className||hit?.tagName||null,pointerEvents:getComputedStyle(section.querySelector('.overlay')).pointerEvents}};
const baseline=[...document.querySelectorAll('[data-case]')].map(hitState);const started=performance.now();(0,eval)(${serializedCode});setTimeout(()=>{const results=[...document.querySelectorAll('[data-case]')].map(hitState);window.__result={label:${JSON.stringify(label)},baseline,results,passed:results.filter(x=>x.pass).length,total:results.length,elapsedMs:performance.now()-started};document.querySelector('#result').textContent=JSON.stringify(window.__result,null,2)},1900);
</script></body></html>`;
}

const server = http.createServer((request, response) => {
  const path = new URL(request.url, `http://127.0.0.1:${port}`).pathname;
  if (path === "/candidate") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(page(candidateCode, "Final Builder candidate"));
    return;
  }
  if (path === "/manual") {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" });
    response.end(page(manualCode, "Manual generic geometry repair"));
    return;
  }
  response.writeHead(404).end("Not found");
});
server.listen(port, "127.0.0.1", () => process.stdout.write(`Overlay diagnostics: http://127.0.0.1:${port}/candidate\n`));

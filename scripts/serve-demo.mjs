import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = await readFile(join(root, "demo", "blocked.html"));
const port = Number(process.env.MONKEYSKILL_DEMO_PORT || 4173);

createServer((request, response) => {
  if (request.url !== "/" && request.url !== "/blocked.html") {
    response.writeHead(404).end("Not found");
    return;
  }
  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
}).listen(port, "127.0.0.1", () => {
  console.log(`MonkeySkill demo: http://127.0.0.1:${port}/blocked.html`);
});


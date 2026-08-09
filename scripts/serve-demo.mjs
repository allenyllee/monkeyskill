import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.MONKEYSKILL_DEMO_PORT || 4173);
const routes = new Map([
  ["/", ["demo/blocked.html", "text/html; charset=utf-8"]],
  ["/blocked.html", ["demo/blocked.html", "text/html; charset=utf-8"]],
  ["/test-background.svg", ["demo/test-background.svg", "image/svg+xml; charset=utf-8"]]
]);

createServer(async (request, response) => {
  const pathname = new URL(request.url, "http://127.0.0.1").pathname;
  const route = routes.get(pathname);
  if (!route) {
    response.writeHead(404).end("Not found");
    return;
  }
  try {
    const body = await readFile(join(root, route[0]));
    response.writeHead(200, {
      "content-type": route[1],
      "cache-control": "no-store",
      "x-content-type-options": "nosniff"
    });
    response.end(body);
  } catch (error) {
    response.writeHead(500).end(error.message);
  }
}).listen(port, "127.0.0.1", () => {
  console.log(`MonkeySkill demo: http://127.0.0.1:${port}/blocked.html`);
});

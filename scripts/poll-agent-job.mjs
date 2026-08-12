import { readFile, writeFile } from "node:fs/promises";

const [role, worker, output] = process.argv.slice(2);
if (!['builder', 'tester'].includes(role) || !worker || !output) {
  throw new Error('Usage: node scripts/poll-agent-job.mjs <builder|tester> <worker> <output>');
}

const bootstrap = JSON.parse(await readFile('.tmp-clean-agent-bootstrap.json', 'utf8'));
const response = await fetch(`http://127.0.0.1:8788/agent/jobs/next?role=${role}&worker=${encodeURIComponent(worker)}&wait=1000`, {
  headers: { authorization: `Bearer ${bootstrap.token}` }
});
if (response.status === 204) {
  process.stdout.write(JSON.stringify({ status: 204 }));
  process.exit(0);
}
const text = await response.text();
if (!response.ok) throw new Error(`Poll failed: HTTP ${response.status} ${text}`);
await writeFile(output, text, { encoding: 'utf8', flag: 'wx' });
const job = JSON.parse(text);
if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(job.id || '')) {
  throw new Error('Poll response is missing a valid job.id UUID.');
}
process.stdout.write(JSON.stringify({ status: response.status, id: job.id, routingKey: job.routingKey, output }));

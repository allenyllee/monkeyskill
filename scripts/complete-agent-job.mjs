import { readFile, writeFile, unlink } from 'node:fs/promises';

const [jobId, worker, contentPath, envelopePath] = process.argv.slice(2);
if (!jobId || !worker || !contentPath || !envelopePath) {
  throw new Error('Usage: node scripts/complete-agent-job.mjs <jobId> <worker> <content.json> <envelope.json>');
}
const bootstrap = JSON.parse(await readFile('.tmp-clean-agent-bootstrap.json', 'utf8'));
const content = await readFile(contentPath, 'utf8');
JSON.parse(content);
const envelope = JSON.stringify({ worker, content });
await writeFile(envelopePath, envelope, { encoding: 'utf8', flag: 'wx' });
try {
  const parsed = JSON.parse(await readFile(envelopePath, 'utf8'));
  if (typeof parsed.worker !== 'string' || typeof parsed.content !== 'string') throw new Error('Invalid completion envelope.');
  JSON.parse(parsed.content);
  const response = await fetch(`http://127.0.0.1:8788/agent/jobs/${jobId}/complete`, {
    method: 'POST',
    headers: { authorization: `Bearer ${bootstrap.token}`, 'content-type': 'application/json' },
    body: await readFile(envelopePath)
  });
  const body = await response.text();
  if (response.status !== 200) throw new Error(`Completion failed: HTTP ${response.status} ${body}`);
  process.stdout.write(JSON.stringify({ status: response.status, body }));
} finally {
  await unlink(envelopePath).catch(() => undefined);
}

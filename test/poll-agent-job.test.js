import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('poll helper preserves the raw body before projecting job fields', async () => {
  const source = await readFile(new URL('../scripts/poll-agent-job.mjs', import.meta.url), 'utf8');
  assert.match(source, /const text = await response\.text\(\)/);
  assert.match(source, /await writeFile\(output, text/);
  assert.ok(source.indexOf('await writeFile(output, text') < source.indexOf('const job = JSON.parse(text)'));
  assert.match(source, /job\.id UUID/);
});

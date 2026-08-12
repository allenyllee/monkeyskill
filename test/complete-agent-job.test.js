import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('completion helper forces content to a UTF-8 string and verifies HTTP 200', async () => {
  const source = await readFile(new URL('../scripts/complete-agent-job.mjs', import.meta.url), 'utf8');
  assert.match(source, /const content = await readFile\(contentPath, 'utf8'\)/);
  assert.match(source, /typeof parsed\.content !== 'string'/);
  assert.match(source, /response\.status !== 200/);
  assert.match(source, /await unlink\(envelopePath\)/);
});

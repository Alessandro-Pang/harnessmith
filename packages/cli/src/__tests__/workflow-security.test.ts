import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = fileURLToPath(new URL('../../../../', import.meta.url));

function readWorkflow(name: string): string {
  return readFileSync(join(root, '.github', 'workflows', name), 'utf8');
}

test('workflows pin third-party actions to immutable commits', () => {
  const files = ['ci.yml', 'docs.yml', 'publish.yml', 'pr-contract.yml'];
  for (const file of files) {
    const workflow = readWorkflow(file);
    for (const line of workflow.split(/\r?\n/).filter((value) => value.includes('uses:'))) {
      assert.match(line, /@[0-9a-f]{40}(?:\s+#\s+v[0-9]+)?$/u, `${file}: ${line}`);
    }
  }
});

test('docs build has read-only permissions and deploy owns Pages write access', () => {
  const workflow = readWorkflow('docs.yml');
  assert.match(workflow, /^permissions:\n  contents: read\n/m);
  assert.doesNotMatch(workflow, /^  pages: write$/m);
  assert.doesNotMatch(workflow, /^  id-token: write$/m);
  assert.match(workflow, /deploy:[\s\S]*?permissions:\n\s+pages: write/u);
  assert.match(workflow, /deploy:[\s\S]*?permissions:[\s\S]*?id-token: write/u);
});

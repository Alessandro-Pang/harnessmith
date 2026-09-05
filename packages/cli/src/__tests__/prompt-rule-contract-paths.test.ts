import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { promptRuleContractIssues } from '../../../../scripts/benchmarks/prompt-route/prompt-rule-contract.js';

test('prompt rule evidence paths reject absolute and traversal spellings', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-prompt-rule-paths-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, 'rules.md'), '# Rules\n');
  const manifest = { entries: { operating: { kind: 'topic' } } };
  const issues = promptRuleContractIssues(root, manifest, {
    version: 1,
    rules: [
      {
        id: 'unsafe',
        owner: 'operating',
        principle: 'Keep the boundary.',
        rationale: 'Avoid host-specific references.',
        action: 'Use repository-relative evidence.',
        fallback: 'Stop when evidence is unavailable.',
        guarantee: 'guided',
        enforcedBy: 'agent',
        boundary: ['/etc/hosts', '../rules.md'],
      },
    ],
  });
  assert.ok(
    issues.includes('prompt rule unsafe references unsafe boundary evidence path: /etc/hosts'),
  );
  assert.ok(
    issues.includes('prompt rule unsafe references unsafe boundary evidence path: ../rules.md'),
  );
});

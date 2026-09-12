import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import {
  automatedBranchPrefix,
  issueBranchPattern,
  longLivedBranches,
} from '../../../../scripts/preflight/branch-contract.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const documentPath = join(
  root,
  'template/skills/agent-harness/docs/references/git-project-overrides.md',
);

function documentedBranchPattern(document: string): string {
  const fences = [...document.matchAll(/```text\n([^\n]+)\n```/g)].map(([, body]) => body.trim());
  const documented = fences.filter((body) => body.startsWith('^'));
  assert.equal(documented.length, 1, 'the override document must publish exactly one branch regex');
  return documented[0] as string;
}

test('documented branch regex matches the mechanical branch contract', () => {
  const document = readFileSync(documentPath, 'utf8');
  assert.equal(documentedBranchPattern(document), issueBranchPattern.source);
});

test('documented branch exemptions match the mechanical branch contract', () => {
  const document = readFileSync(documentPath, 'utf8');
  for (const branch of longLivedBranches) {
    assert.match(document, new RegExp(`\`${branch}\``));
  }
  assert.match(document, new RegExp(`\`${automatedBranchPrefix}\``));
  assert.match(document, /scripts\/preflight\/branch-contract\.ts/);
});

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import {
  repositoryRoot,
  runPromptRouteBenchmark,
} from '../../scripts/prompt-route-benchmark-lib.js';

function run(args: string[]) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/prompt-route-benchmark.ts', ...args],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  );
}

test('prompt route benchmark CLI is CI-runnable and compares the same inputs', () => {
  const direct = run(['--json']);
  assert.equal(direct.status, 0, direct.stderr);
  const report = JSON.parse(direct.stdout);
  assert.equal(report.version, 1);
  assert.equal(report.result, 'passed');

  const root = mkdtempSync(join(tmpdir(), 'harness-prompt-route-benchmark-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const baseline = join(root, 'baseline.json');
  writeFileSync(baseline, JSON.stringify(runPromptRouteBenchmark()));
  const compared = run(['--json', '--baseline-report', baseline]);
  assert.equal(compared.status, 0, compared.stderr);
  assert.equal(JSON.parse(compared.stdout).comparison.sameInput, true);
});

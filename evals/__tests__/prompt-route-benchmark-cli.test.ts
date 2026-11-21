import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { test } from 'vitest';
import { repositoryRoot } from '../../scripts/benchmarks/prompt-route/prompt-route-benchmark-lib.js';

function run(args: string[]) {
  return spawnSync(
    process.execPath,
    ['--import', 'tsx', 'scripts/benchmarks/prompt-route/prompt-route-benchmark.ts', ...args],
    {
      cwd: repositoryRoot,
      encoding: 'utf8',
    },
  );
}

test('prompt route benchmark CLI is CI-runnable with a single JSON smoke run', {
  timeout: 120_000,
}, () => {
  const direct = run(['--json']);
  assert.equal(direct.status, 0, direct.stderr);
  const report = JSON.parse(direct.stdout);
  assert.equal(report.version, 1);
  assert.equal(report.result, 'passed');
});

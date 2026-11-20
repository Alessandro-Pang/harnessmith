import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { root, temporaryDirectory } from './run-fixture.js';

test('F16 invalid candidate extraction cleans the disposable scenario workspace', () => {
  const tempRoot = temporaryDirectory();
  const outputRoot = join(tempRoot, 'output');
  const invalidCandidate = join(tempRoot, 'invalid-candidate.tgz');
  mkdirSync(outputRoot, { recursive: true });
  writeFileSync(invalidCandidate, 'not a tarball\n');

  const result = spawnSync(
    process.execPath,
    [
      '--import',
      'tsx',
      join(root, 'scripts', 'evaluation', 'codex', 'scenario-runner.mjs'),
      'progressive-disclosure',
    ],
    {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        TMPDIR: tempRoot,
        HARNESS_RELEASE_ARTIFACT: invalidCandidate,
        HARNESS_EVAL_OUTPUT_DIR: outputRoot,
        HARNESS_EVAL_MODEL: 'local-static-fixture',
        HARNESS_EVAL_MAX_ATTEMPTS: '2',
        HARNESS_EVAL_FIXTURE_ONLY: '0',
      },
    },
  );

  assert.notEqual(result.status, 0, 'the invalid candidate must fail before Host execution');
  assert.deepEqual(
    readdirSync(tempRoot).filter((entry) => entry.startsWith('harnessmith-codex-scenario-')),
    [],
    result.stderr,
  );
});

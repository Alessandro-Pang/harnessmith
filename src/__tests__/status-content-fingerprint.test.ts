import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { createAdapter } from '../adapters/adapters.js';
import { effectiveContentFingerprint } from '../status/effective-content-fingerprint.js';
import { installAll } from '../installation/install.js';
import { inspectStatusAll, statusAll } from '../installation/lifecycle.js';
import { explainStatus } from '../status/status-explanation.js';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex-home'),
    HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
    HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
    HARNESS_REPOSITORY_ROOT: join(root, 'repositories'),
    HARNESS_OWNER: 'fingerprint-test',
  };
  return { root, env, adapter: createAdapter('codex', { env }) };
}

test('effective content fingerprints are stable across absolute installation homes', () => {
  const left = fixture('harnessmith-fingerprint-left-');
  const right = fixture('harnessmith-fingerprint-right-');
  installAll([left.adapter], { env: left.env, noInitGlobal: true });
  installAll([right.adapter], { env: right.env, noInitGlobal: true });

  const leftStatus = statusAll([left.adapter])[0];
  const rightStatus = statusAll([right.adapter])[0];

  assert.equal(leftStatus.contentFingerprint.state, 'matched');
  assert.equal(leftStatus.contentFingerprint.recorded, leftStatus.contentFingerprint.current);
  assert.match(leftStatus.contentFingerprint.current, /^sha256:[a-f0-9]{64}$/);
  assert.deepEqual(leftStatus.contentFingerprint, rightStatus.contentFingerprint);
});

test('effective content fingerprints expose drift and status explanation evidence', () => {
  const { env, adapter } = fixture('harnessmith-fingerprint-drift-');
  installAll([adapter], { env, noInitGlobal: true });
  const before = statusAll([adapter])[0].contentFingerprint;

  writeFileSync(adapter.instructions[0].path, 'modified instructions\n');
  const after = statusAll([adapter])[0].contentFingerprint;

  assert.equal(after.state, 'drifted');
  assert.equal(after.recorded, before.recorded);
  assert.notEqual(after.current, before.current);
  assert.deepEqual(
    explainStatus(inspectStatusAll([adapter])[0]).evidence.contentFingerprint,
    after,
  );

  rmSync(adapter.harness, { recursive: true });
  const missing = statusAll([adapter])[0].contentFingerprint;
  assert.equal(missing.state, 'drifted');
  assert.notEqual(missing.current, after.current);
});

test('unmanaged content has a current fingerprint without a recorded identity', () => {
  const { adapter } = fixture('harnessmith-fingerprint-unmanaged-');
  mkdirSync(adapter.home, { recursive: true });
  writeFileSync(adapter.instructions[0].path, 'unmanaged instructions\n');

  const status = statusAll([adapter])[0];

  assert.equal(status.installed, false);
  assert.deepEqual(status.contentFingerprint, {
    version: 1,
    algorithm: 'sha256',
    state: 'unrecorded',
    recorded: null,
    current: status.contentFingerprint.current,
  });
  assert.match(status.contentFingerprint.current, /^sha256:[a-f0-9]{64}$/);
});

test('legacy installation records remain readable and report an unrecorded fingerprint', () => {
  const { env, adapter } = fixture('harnessmith-fingerprint-legacy-');
  installAll([adapter], { env, noInitGlobal: true });
  const record = JSON.parse(readFileSync(adapter.record, 'utf8'));
  delete record.contentFingerprint;
  writeFileSync(adapter.record, `${JSON.stringify(record, null, 2)}\n`);

  const status = statusAll([adapter])[0];

  assert.equal(status.installed, true);
  assert.ok(status.outputs.every(({ status: value }) => value === 'managed'));
  assert.equal(status.contentFingerprint.state, 'unrecorded');
  assert.equal(status.contentFingerprint.recorded, null);
});

test('a malformed install context is reported as drift instead of breaking status', () => {
  const { env, adapter } = fixture('harnessmith-fingerprint-context-');
  installAll([adapter], { env, noInitGlobal: true });
  writeFileSync(join(adapter.harness, 'install-context.json'), '{invalid json\n');

  const status = statusAll([adapter])[0];

  assert.equal(status.contentFingerprint.state, 'drifted');
  assert.ok(status.outputs.some(({ status: value }) => value === 'modified'));
});

test('fingerprint normalization handles JSON-escaped Windows paths', () => {
  const left = fixture('harnessmith-fingerprint-windows-left-');
  const right = fixture('harnessmith-fingerprint-windows-right-');
  for (const [fixtureValue, root] of [
    [left, 'C:\\Users\\left'],
    [right, 'C:\\Users\\right'],
  ] as const) {
    mkdirSync(fixtureValue.adapter.harness, { recursive: true });
    const harnessHome = `${root}\\.codex`;
    const instruction = `${harnessHome}\\AGENTS.md`;
    writeFileSync(
      join(fixtureValue.adapter.harness, 'install-context.json'),
      `${JSON.stringify(
        {
          version: 1,
          adapter: 'codex',
          harnessHome,
          instructionFiles: [instruction],
          memoryHome: `${root}\\.agent-docs`,
          personalHome: `${root}\\.agent-harness`,
          repositoryRoot: `${root}\\git-repo`,
          owner: 'fingerprint-test',
        },
        null,
        2,
      )}\n`,
    );
    writeFileSync(fixtureValue.adapter.instructions[0].path, `Read ${harnessHome}\\docs\n`);
  }

  assert.equal(
    effectiveContentFingerprint(left.adapter),
    effectiveContentFingerprint(right.adapter),
  );
});

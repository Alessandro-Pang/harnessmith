import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { evaluateReplayContract } from '../lib/replay/replay-contract.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

const exactReplay = {
  version: 1 as const,
  kind: 'identical-replay' as const,
  signalId: 'host-signal-2',
  previousSignalId: 'host-signal-1',
  payload: { path: '/tmp/checkpoint.json', digest: `sha256:${'a'.repeat(64)}` },
  previousPayload: { path: '/tmp/checkpoint.json', digest: `sha256:${'a'.repeat(64)}` },
  commandExact: true,
  output: { observed: false },
  persistedState: {
    path: '/project/.agent-docs/sessions/checkpoint.md',
    reference: 'memory:sessions/checkpoint',
    generation: 1,
    previousGeneration: 1,
    beforeDigest: `sha256:${'b'.repeat(64)}`,
    afterDigest: `sha256:${'b'.repeat(64)}`,
    beforeWorkspaceDigest: `sha256:${'c'.repeat(64)}`,
    afterWorkspaceDigest: `sha256:${'c'.repeat(64)}`,
  },
  verifier: {
    command: 'node verify.mjs docs/status.txt',
    exitCode: 0,
    candidateDigest: `sha256:${'d'.repeat(64)}`,
    currentCandidateDigest: `sha256:${'d'.repeat(64)}`,
    workspaceDigest: `sha256:${'c'.repeat(64)}`,
  },
};

test('an identical replay is proven without stdout only by exact persisted state', () => {
  const report = evaluateReplayContract(exactReplay);
  assert.equal(report.decision, 'skip-duplicate');
  assert.equal(report.result, 'verified');
  assert.equal(report.reasonCode, 'identical-replay-state-proven');

  for (const drift of [
    { persistedState: { ...exactReplay.persistedState, afterDigest: `sha256:${'e'.repeat(64)}` } },
    { commandExact: false },
    { persistedState: { ...exactReplay.persistedState, generation: 2 } },
    {
      verifier: {
        ...exactReplay.verifier,
        currentCandidateDigest: `sha256:${'e'.repeat(64)}`,
      },
    },
  ]) {
    const rejected = evaluateReplayContract({ ...exactReplay, ...drift });
    assert.equal(rejected.result, 'inconclusive');
    assert.notEqual(rejected.decision, 'execute');
  }
});

test('new mutation, duplicate delivery, and failed retry have deterministic decisions', () => {
  const fresh = evaluateReplayContract({
    ...exactReplay,
    kind: 'new-mutation',
    previousPayload: undefined,
    previousSignalId: undefined,
  });
  assert.equal(fresh.decision, 'execute');
  assert.equal(fresh.reasonCode, 'new-mutation-ready');

  const inexactFresh = evaluateReplayContract({
    ...exactReplay,
    kind: 'new-mutation',
    previousPayload: undefined,
    previousSignalId: undefined,
    commandExact: false,
  });
  assert.equal(inexactFresh.decision, 'new-payload-required');
  assert.equal(inexactFresh.reasonCode, 'new-mutation-command-inexact');

  const duplicate = evaluateReplayContract({
    ...exactReplay,
    previousSignalId: exactReplay.signalId,
  });
  assert.equal(duplicate.decision, 'skip-duplicate');
  assert.equal(duplicate.reasonCode, 'duplicate-signal-state-proven');

  const failed = evaluateReplayContract({ ...exactReplay, previousAttempt: 'failed' });
  assert.equal(failed.decision, 'new-payload-required');
  assert.equal(failed.reasonCode, 'failed-attempt-frozen');
});

test('replay verification CLI is read-only and schema-backed', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-replay-contract-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const input = join(root, 'replay.json');
  writeFileSync(input, JSON.stringify(exactReplay));
  const before = readFileSync(input, 'utf8');
  const io = capturedIo();

  assert.equal(
    runCli(['replay', 'verify', '--payload-file', input, '--json'], {
      runtime: harnessRuntime(root),
      io,
    }),
    0,
  );
  assert.equal(JSON.parse(io.logs[0]).result, 'verified');
  assert.equal(readFileSync(input, 'utf8'), before);
  const schema = JSON.parse(
    readFileSync(
      join(process.cwd(), 'template/agent-harness/schemas/replay-report.schema.json'),
      'utf8',
    ),
  );
  assert.equal(schema.$id, 'urn:agent-harness:schema:replay-report:v1');

  writeFileSync(
    input,
    JSON.stringify({
      ...exactReplay,
      persistedState: { ...exactReplay.persistedState, afterDigest: `sha256:${'e'.repeat(64)}` },
    }),
  );
  assert.equal(
    runCli(['replay', 'verify', '--payload-file', input, '--json'], {
      runtime: harnessRuntime(root),
      io: capturedIo(),
    }),
    2,
  );
});

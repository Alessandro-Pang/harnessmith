import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { initProject } from '../commands/init.js';
import { digestPath } from '../lib/filesystem/files.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

test('a duplicate host signal replay leaves the persisted Handoff unchanged', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-host-signal-replay-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const payload = join(root, 'checkpoint.json');
  writeFileSync(
    payload,
    JSON.stringify({
      session: 'host-thread-42',
      title: 'Host signal replay',
      objective: 'Preserve the verified task state.',
      completed: 'The requested edit was verified.',
      verification: 'node verify.mjs docs/status.txt; exit 0',
      next: 'Continue with docs/follow-up.txt.',
      reason: 'compaction',
    }),
  );

  const first = capturedIo();
  assert.equal(
    runCli(['memory', 'handoff', project, '--payload-file', payload, '--json'], {
      runtime,
      io: first,
    }),
    0,
  );
  const path = JSON.parse(first.logs[0]).path;
  const before = digestPath(join(project, '.agent-docs'));
  const persisted = readFileSync(path, 'utf8');

  const replay = capturedIo();
  assert.equal(
    runCli(['memory', 'handoff', project, '--payload-file', payload, '--json'], {
      runtime,
      io: replay,
    }),
    0,
  );
  assert.equal(JSON.parse(replay.logs[0]).action, 'unchanged');
  assert.equal(readFileSync(path, 'utf8'), persisted);
  assert.equal(digestPath(join(project, '.agent-docs')), before);
});

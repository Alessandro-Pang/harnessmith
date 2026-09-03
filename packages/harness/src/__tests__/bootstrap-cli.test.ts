import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

test('Harness bootstrap CLI defaults to brief and exposes explicit full detail', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-bootstrap-cli-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const runtime = harnessRuntime(root);
  const briefOutput = capturedIo();
  const fullOutput = capturedIo();

  assert.equal(
    runCli(['bootstrap', '--project', project, '--json'], { runtime, io: briefOutput }),
    0,
  );
  assert.equal(
    runCli(['bootstrap', '--project', project, '--detail', 'full', '--json'], {
      runtime,
      io: fullOutput,
    }),
    0,
  );

  const brief = JSON.parse(briefOutput.logs[0]);
  const full = JSON.parse(fullOutput.logs[0]);
  assert.equal(brief.detail, 'brief');
  assert.equal('metadata' in brief.memory, false);
  assert.equal(full.detail, 'full');
  assert.ok(Array.isArray(full.memory.metadata));
});

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

test('Harness CLI exposes typed proposal-only memory promotion JSON', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-promote-cli-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(join(project, '.agent-docs', 'distilled'), { recursive: true });
  writeFileSync(
    join(project, '.agent-docs', 'distilled', 'finding.md'),
    `---\ntitle: Finding\ndescription: Expensive finding\ntype: distilled-memory\nmemory-kind: distilled\nstatus: active\nowners: [test-owner]\ncreated: 2026-08-19\nupdated: 2026-08-19\nproject: test\ntags: [test]\nscope: []\nsource-refs: [docs/source.md]\nsource-of-truth: false\nschema-version: 1\n---\n\n# Finding\n`,
  );
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  const output = capturedIo();

  assert.equal(
    runCli(
      [
        'memory',
        'promote',
        project,
        'distilled/finding',
        '--target',
        'docs/finding.md',
        '--artifact-type',
        'docs',
        '--owner',
        'docs-owner',
        '--reason',
        'Promote the finding into maintained documentation.',
        '--verifier',
        'pnpm run check:docs',
        '--json',
      ],
      { runtime, io: output },
    ),
    0,
  );
  const proposal = JSON.parse(output.logs[0]);
  assert.equal(proposal.version, 2);
  assert.equal(proposal.mode, 'proposal-only');
  assert.equal(proposal.target.artifactType, 'docs');
  assert.equal(proposal.target.owner, 'docs-owner');
  assert.deepEqual(proposal.unmetConditions, ['formal-write-authorization-required']);
  assert.equal(existsSync(join(project, 'docs', 'finding.md')), false);
});

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test, vi } from 'vitest';
import { temporaryResourceReport } from '../../../../scripts/temporary-resources/temp-resources.js';
import { createTemporaryWorkspace } from '../temporary-resources/temporary-resource.js';

function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-temp-report-test-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('writes a machine-readable dry-run report for an explicit root', () => {
  const root = fixture();
  const workspace = createTemporaryWorkspace({
    base: root,
    owner: 'eval',
    purpose: 'host-eval',
    lifecycle: 'workstream',
  });
  const write = vi.spyOn(process.stdout, 'write').mockImplementation(() => true);

  temporaryResourceReport(['--root', root, '--json']);

  assert.equal(write.mock.calls.length, 1);
  const report = JSON.parse(String(write.mock.calls[0]?.[0])) as {
    action?: string;
    resources?: Array<{ path?: string }>;
  };
  assert.equal(report.action, 'dry-run');
  assert.deepEqual(
    report.resources?.map(({ path }) => path),
    [workspace.path],
  );
});

test('writes a readable resource summary without deleting managed resources', () => {
  const root = fixture();
  const workspace = createTemporaryWorkspace({
    base: root,
    owner: 'release',
    purpose: 'clean-room',
    lifecycle: 'retained-for-recovery',
  });
  const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);

  temporaryResourceReport(['--root', root]);

  assert.match(String(log.mock.calls[0]?.[0]), /1 resource\(s\)/);
  assert.match(String(log.mock.calls[1]?.[0]), /release\/clean-room/);
  assert.equal(String(log.mock.calls[1]?.[0]).includes(workspace.path), true);
});

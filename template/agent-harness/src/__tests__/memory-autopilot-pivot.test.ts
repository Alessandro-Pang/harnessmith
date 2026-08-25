import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import * as memoryAutopilot from '../commands/memory-autopilot.js';
import { parseFrontmatterDocument } from '../lib/frontmatter.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

test('Handoff snapshots replace unrelated pivot fields without leaking prior task state', () => {
  const root = mkdtempSync(join(tmpdir(), 'harness-handoff-unrelated-pivot-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  const session = 'stable-host-thread-unrelated-pivot';

  const first = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      session,
      title: 'Payment retry implementation',
      objective: 'Finish the payment retry workflow.',
      completed: 'Implemented the payment retry workflow with detailed phase notes.',
      facts: 'The retry uses the legacy gateway.\n\nShared constraint: keep writes local.',
      decisions: 'Retain the legacy gateway adapter.',
      verification: 'Payment retry tests passed: 8/8.',
      open: 'Confirm the production retry interval.',
      next: 'Review the payment retry rollout.',
      reason: 'phase',
      scope: ['src/payment-retry.ts'],
      sourceRefs: ['docs/payment-retry.md'],
    },
    capturedIo(),
  );

  const pivoted = memoryAutopilot.captureHandoff(
    runtime,
    project,
    {
      session,
      title: 'Docs routing audit',
      objective: 'Audit unrelated documentation routing.',
      completed: 'Finished payment retry; pivoted to the docs audit.',
      facts: 'Shared constraint: keep writes local.',
      next: 'Verify the docs routing manifest.',
      reason: 'multi-task',
      scope: ['template/agent-harness/docs'],
      sourceRefs: ['template/agent-harness/docs/manifest.yaml'],
      clearDecisions: true,
      clearVerification: true,
      clearOpen: true,
    },
    capturedIo(),
  );

  assert.equal(pivoted.path, first.path);
  const snapshot = readFileSync(pivoted.path, 'utf8');
  const parsed = parseFrontmatterDocument(snapshot);
  const body = parsed.body.trimStart();
  assert.equal(pivoted.action, 'updated');
  assert.equal(parsed.metadata.get('title'), 'Docs routing audit');
  assert.deepEqual(parsed.metadata.get('scope'), ['template/agent-harness/docs']);
  assert.deepEqual(parsed.metadata.get('source-refs'), [
    'template/agent-harness/docs/manifest.yaml',
  ]);
  assert.match(body, /^# 当前目标\n\nAudit unrelated documentation routing\./);
  assert.match(body, /# 已确认事实\n\nShared constraint: keep writes local\./);
  assert.match(body, /# 已完成\n\nFinished payment retry; pivoted to the docs audit\./);
  assert.match(body, /# 下一步\n\nVerify the docs routing manifest\.\n$/);
  assert.equal(snapshot.match(/Shared constraint: keep writes local\./g)?.length, 1);
  assert.doesNotMatch(
    snapshot,
    /Payment retry implementation|Finish the payment retry workflow|Review the payment retry rollout/,
  );
  assert.doesNotMatch(snapshot, /src\/payment-retry\.ts|docs\/payment-retry\.md/);
  assert.doesNotMatch(snapshot, /The retry uses the legacy gateway/);
  assert.doesNotMatch(snapshot, /# 关键决策|Retain the legacy gateway adapter/);
  assert.doesNotMatch(snapshot, /# 验证证据|Payment retry tests passed/);
  assert.doesNotMatch(snapshot, /# 未解决事项|Confirm the production retry interval/);
  assert.doesNotMatch(snapshot, /Implemented the payment retry workflow with detailed phase notes/);
});

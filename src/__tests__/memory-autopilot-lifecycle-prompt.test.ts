import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';

const root = join(import.meta.dirname, '..', '..');
const documents = new Map(
  [
    ['agents', 'template/AGENTS.md'],
    ['operating-model', 'template/agent-harness/docs/core/operating-model.md'],
    ['long-running-tasks', 'template/agent-harness/docs/core/long-running-tasks.md'],
    ['cli-architecture', 'template/agent-harness/docs/core/harness-cli-architecture.md'],
    ['project-memory', 'template/agent-harness/docs/standards/project-agent-docs.md'],
    ['user-profile', 'template/agent-harness/docs/standards/user-profile-memory.md'],
  ].map(([name, path]) => [name, readFileSync(join(root, path), 'utf8')]),
);

function owners(pattern: RegExp): string[] {
  return [...documents].flatMap(([name, content]) => (pattern.test(content) ? [name] : []));
}

test('handoff lifecycle has one normative owner', () => {
  assert.deepEqual(owners(/clearOpen/), ['long-running-tasks']);
  assert.deepEqual(owners(/仅部分 resolved.*replacement `open`/), ['long-running-tasks']);
  assert.deepEqual(owners(/Task ledger[^\n]*唯一[^\n]*事实源/), ['long-running-tasks']);
  assert.deepEqual(owners(/phase[^\n]*compaction[^\n]*multi-task[^\n]*manual/), [
    'long-running-tasks',
  ]);
});

test('payload and profile command contracts have dedicated owners', () => {
  assert.deepEqual(owners(/--consume-payload-file/), ['cli-architecture']);
  assert.deepEqual(owners(/profile-autopilot pause/), ['user-profile']);
});

test('entry output summaries route field and host-signal protocols to dedicated owners', () => {
  assert.deepEqual(owners(/action.*path.*validation/), ['project-memory']);
  assert.deepEqual(owners(/恢复.*检索.*修复.*归档.*校验/), ['project-memory']);
  assert.deepEqual(owners(/允许空响应.*agent_message.*强制响应/), ['long-running-tasks']);
});

test('supporting documents route to owners instead of restating their protocols', () => {
  assert.match(documents.get('project-memory') ?? '', /long-running-tasks\.md/);
  assert.match(documents.get('project-memory') ?? '', /harness-cli-architecture\.md/);
  assert.match(documents.get('operating-model') ?? '', /long-running-tasks\.md/);
});

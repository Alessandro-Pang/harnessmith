import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';

const root = join(import.meta.dirname, '..', '..', '..', '..');
const longRunningCore = readFileSync(
  join(root, 'template/agent-harness/docs/core/long-running-tasks.md'),
  'utf8',
);
const longRunningReference = readFileSync(
  join(root, 'template/agent-harness/docs/references/task-and-replay-contracts.md'),
  'utf8',
);
const projectMemoryCore = readFileSync(
  join(root, 'template/agent-harness/docs/standards/project-agent-docs.md'),
  'utf8',
);
const projectMemoryReference = readFileSync(
  join(root, 'template/agent-harness/docs/references/memory-contracts.md'),
  'utf8',
);
const userProfileCore = readFileSync(
  join(root, 'template/agent-harness/docs/standards/user-profile-memory.md'),
  'utf8',
);
const userProfileReference = readFileSync(
  join(root, 'template/agent-harness/docs/references/profile-contracts.md'),
  'utf8',
);
const cliContractsReference = readFileSync(
  join(root, 'template/agent-harness/docs/references/cli-contracts.md'),
  'utf8',
);
const observabilityCore = readFileSync(
  join(root, 'template/agent-harness/docs/core/observability.md'),
  'utf8',
);
const toolRoutingCore = readFileSync(
  join(root, 'template/agent-harness/docs/core/tool-routing.md'),
  'utf8',
);
const documents = new Map([
  ['agents', readFileSync(join(root, 'template/AGENTS.md'), 'utf8')],
  [
    'operating-model',
    readFileSync(join(root, 'template/agent-harness/docs/core/operating-model.md'), 'utf8'),
  ],
  ['long-running-tasks', [longRunningCore, longRunningReference].join('\n')],
  [
    'cli-architecture',
    readFileSync(
      join(root, 'template/agent-harness/docs/core/harness-cli-architecture.md'),
      'utf8',
    ),
  ],
  ['cli-architecture-reference', cliContractsReference],
  ['project-memory', projectMemoryCore],
  ['project-memory-reference', projectMemoryReference],
  ['user-profile', userProfileCore],
  ['user-profile-reference', userProfileReference],
]);

function owners(pattern: RegExp): string[] {
  return [...documents].flatMap(([name, content]) => (pattern.test(content) ? [name] : []));
}

test('handoff lifecycle has one normative owner', () => {
  assert.deepEqual(owners(/clearOpen/), ['long-running-tasks']);
  assert.deepEqual(owners(/仅部分 resolved.*replacement `open`/), ['long-running-tasks']);
  assert.deepEqual(owners(/Task ledger[^\n]*唯一[^\n]*事实源/), ['long-running-tasks']);
  assert.deepEqual(owners(/compaction[^\n]*multi-task[^\n]*phase[^\n]*manual/), [
    'long-running-tasks',
  ]);
});

test('payload and profile command contracts have dedicated owners', () => {
  assert.deepEqual(owners(/--consume-payload-file/), ['cli-architecture-reference']);
  assert.deepEqual(owners(/profile-autopilot pause/), ['user-profile-reference']);
});

test('entry output summaries route field and host-signal protocols to dedicated owners', () => {
  assert.deepEqual(owners(/action.*path.*validation/), ['project-memory']);
  assert.deepEqual(owners(/恢复、检索、写入、校验和维护保持静默/), ['project-memory']);
  assert.deepEqual(owners(/允许空响应.*agent_message.*强制响应/), ['long-running-tasks']);
});

test('supporting documents route to owners instead of restating their protocols', () => {
  assert.match(documents.get('project-memory') ?? '', /long-running-tasks\.md/);
  assert.match(documents.get('project-memory') ?? '', /harness-cli-architecture\.md/);
  assert.match(documents.get('operating-model') ?? '', /long-running-tasks\.md/);
});

test('long-running core keeps the decision surface bounded and defers mechanical contracts', () => {
  assert.ok(longRunningCore.trimEnd().split('\n').length <= 110);
  assert.match(longRunningCore, /详细.*task.*verification.*replay.*reference/s);
  assert.doesNotMatch(longRunningCore, /clearOpen|task verify|--payload-file/);
  assert.match(longRunningReference, /clearOpen/);
  assert.match(longRunningReference, /identical-replay/);
  assert.match(longRunningReference, /scope digest/);
});

test('core prompts defer command and budget details to their owner references', () => {
  assert.doesNotMatch(observabilityCore, /audit record --payload-file|--consume-payload-file/);
  assert.match(cliContractsReference, /audit record.*payload-file|--consume-payload-file/s);
  assert.doesNotMatch(toolRoutingCore, /--refresh-index|--max-line-length|5000|8 MiB/);
  assert.match(cliContractsReference, /--refresh-index/);
});

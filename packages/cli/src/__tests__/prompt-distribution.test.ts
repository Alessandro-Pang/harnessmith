import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

test('search documentation records every default scan budget in one authoritative location', () => {
  const searchReference = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'references', 'search-and-benchmarks.md'),
    'utf8',
  );
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');

  for (const contract of [
    '8 层',
    '5000 个目录条目',
    '1000 个目录',
    '1000 个普通文件',
    '单文件 1 MiB',
    '总计 8 MiB',
    '2 秒',
  ]) {
    assert.ok(searchReference.includes(contract), `missing search budget contract: ${contract}`);
  }
  assert.doesNotMatch(readme, /默认的 8 层、1000 个文件/);
  assert.doesNotMatch(english, /defaults to 8 levels, 1,000 files/);
});

test('prompt layers keep bounded context budgets and defer low-frequency detail', () => {
  const read = (relativePath: string) => readFileSync(join(root, relativePath), 'utf8');
  const lineCount = (value: string) => value.trimEnd().split('\n').length;
  const approximateTokens = (value: string) => Math.ceil(value.length / 4);

  const entry = read('template/AGENTS.md');
  const index = read('template/agent-harness/docs/README.md');
  assert.ok(lineCount(entry) <= 50, `entry prompt exceeds 50 lines (${lineCount(entry)})`);
  assert.ok(lineCount(index) <= 80, `docs index exceeds 80 lines (${lineCount(index)})`);
  assert.ok(approximateTokens(entry) <= 650, 'entry prompt exceeds its approximate token budget');
  assert.ok(approximateTokens(index) <= 950, 'docs index exceeds its approximate token budget');

  for (const relativePath of [
    'template/agent-harness/docs/core/operating-model.md',
    'template/agent-harness/docs/core/harness-cli-architecture.md',
    'template/agent-harness/docs/core/long-running-tasks.md',
    'template/agent-harness/docs/standards/project-agent-docs.md',
    'template/agent-harness/docs/standards/user-profile-memory.md',
  ]) {
    const content = read(relativePath);
    assert.ok(lineCount(content) <= 110, `${relativePath} exceeds 110 lines`);
  }

  for (const relativePath of [
    'template/agent-harness/docs/references/cli-contracts.md',
    'template/agent-harness/docs/references/memory-contracts.md',
    'template/agent-harness/docs/references/profile-contracts.md',
    'template/agent-harness/docs/references/repository-map-contracts.md',
    'template/agent-harness/docs/references/task-and-replay-contracts.md',
  ]) {
    const content = read(relativePath);
    assert.ok(lineCount(content) <= 220, `${relativePath} exceeds reference budget`);
  }

  assert.match(
    read('template/agent-harness/docs/standards/prompt-rule-contract.md'),
    /Reference.*低频|Reference.*低频/s,
  );
  assert.match(read('template/agent-harness/docs/README.md'), /reference.*候选|references.*按需/s);
});

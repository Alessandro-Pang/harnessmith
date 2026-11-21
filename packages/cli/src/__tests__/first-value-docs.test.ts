import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

const states = ['installed', 'healthy', 'host-configured', 'host-verified'];

test('the first-value journey owns the four states, their owners, and the local evidence boundary', () => {
  const journey = read('apps/docs/site/zh/guide/first-value-loop.md');

  for (const state of states) {
    assert.match(journey, new RegExp(`\\\`${state}\\\``), `journey must define ${state}`);
  }
  // The state table must keep the owner column and the local-CLI provability boundary.
  assert.match(journey, /\| 状态 \| 证明内容 \| 主要 owner \| 本地 CLI 能否独立证明 \|/);
  assert.match(journey, /前两项状态由本地 CLI 证明，后两项必须在真实宿主会话中确认/);
  assert.match(journey, /没有证据时必须保持 `inconclusive`/);
  assert.match(journey, /diagnostics --agent <agent> --json/);
});

test('getting-started uses the same state vocabulary and routes the next step to diagnostics', () => {
  const guide = read('apps/docs/site/zh/guide/getting-started.md');

  for (const state of states) {
    assert.ok(guide.includes(state), `getting-started must use the ${state} state`);
  }
  assert.match(guide, /`setup` 能在本地证明前两项/);
  assert.match(guide, /`status` 只证明 `installed`，不会顺带证明 `healthy`/);
  assert.match(guide, /diagnostics --agent <agent> --json/);
  assert.match(guide, /\[首次价值循环\]\(\/guide\/first-value-loop\)/);
});

test('the installer CLI reference keeps status and setup projections honest about host states', () => {
  const cli = read('apps/docs/site/zh/reference/cli.md');

  for (const state of states) {
    assert.ok(cli.includes(state), `cli reference must use the ${state} state`);
  }
  assert.match(cli, /setup 可本地证明前两项，后两项在没有真实 Host 证据时保持 `inconclusive`/);
  assert.match(cli, /只把 `managed` 映射为 `installed: passed`/);
  assert.match(cli, /`healthy` 仍为 `not-checked`/);
  assert.match(cli, /diagnostics --agent <agent> --json/);
});

test('llms.txt instructs agents to use the exact First Value states and the diagnostics next step', () => {
  const llms = read('llms.txt');

  assert.match(
    llms,
    /Use the shared First Value states exactly: `installed`, `healthy`, `host-configured`, and `host-verified`/,
  );
  assert.match(llms, /diagnostics --agent <agent> --json/);
  assert.match(
    llms,
    /Keep Host-owned states inconclusive until a real Host run supplies tool,\s+filesystem, and verifier evidence/,
  );
});

test('public journey rejects download, traffic, and local-test activity claims', () => {
  const journey = read('apps/docs/site/zh/guide/first-value-loop.md');

  assert.match(journey, /本地测试、npm downloads 或 GitHub traffic 都不能替代或推断它们/);
  assert.match(journey, /local-baseline-passed/);
  assert.match(
    journey,
    /`hostConfigured`、`hostVerified` 和 `firstValueAchieved` 仍应是 `inconclusive` 或 `false`/,
  );
  assert.match(journey, /退出码为 0 或最终文本说“完成”都不能单独构成 `passed`/);
});

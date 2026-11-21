import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

test('memory-contracts reference owns proposal identity, bounded apply, and typed lifecycle delegation', () => {
  const reference = read('template/skills/agent-harness/docs/references/memory-contracts.md');

  assert.match(reference, /`memory curate <project> --task <id> --json` 默认只读/);
  assert.match(
    reference,
    /候选必须有稳定\s+`proposalId`、source digest、workspace digest、`expiresOn`、前置条件和 verifier/,
  );
  assert.match(reference, /显式 apply 只接受有界 proposal\s+集并带 `--yes`/);
  assert.match(reference, /stale\/changed\/expired 必须重新生成/);
  assert.match(reference, /close\/supersede\/archive 走各自 typed lifecycle/);
  assert.match(reference, /partial failure 逐项报告，不能\s+冒充整批成功/);
  assert.match(reference, /curation apply 与 acceptance gate 相互独立/);
});

test('project-memory standard keeps curation proposal-first and separate from Task completion', () => {
  const standard = read('template/skills/agent-harness/docs/standards/project-agent-docs.md');

  assert.match(standard, /`memory curate` 默认只读、proposal-first/);
  assert.match(standard, /它不完成或验证 Task/);
  assert.match(standard, /close、supersede、archive 仍走各自 typed lifecycle/);
  assert.match(standard, /proposal 过期、source 或 workspace 漂移时必须重新生成/);
  assert.match(standard, /partial failure 不得冒充整批成功/);
  assert.match(standard, /详细 proposal identity、apply 和 relationships 契约见 reference/);
});

test('CLI architecture core states promotion stays a proposal and defers the state machine', () => {
  const architecture = read('template/skills/agent-harness/docs/core/harness-cli-architecture.md');

  assert.match(architecture, /Memory curation 的 promotion 只生成 proposal，不直接写入事实源/);
  assert.match(architecture, /本文件不复制这些字段和状态机/);
  assert.doesNotMatch(architecture, /proposalId|sourceDigest|expiresOn|--apply-file/);
});

test('public runtime CLI reference documents explicit bounded curation apply', () => {
  const runtime = read('apps/docs/site/zh/reference/runtime-cli.md');

  assert.match(runtime, /`memory curate` 默认仍是零写入的 `proposal-only` 报告/);
  assert.match(runtime, /Task close 不会自动执行候选/);
  assert.match(runtime, /稳定 `proposalId`、`sourceDigest`.*`expiresOn`、前置条件和精确 verifier/s);
  assert.match(runtime, /显式执行必须选择 1–16 个 proposal，并传入 `--yes`/);
  assert.match(runtime, /source、工作区、Task 状态、引用关系或日期变化都会 fail closed/);
  assert.match(runtime, /close、supersede 与 archive 只调用既有 typed lifecycle/);
  assert.match(runtime, /promotion 只调用正式 promotion proposal 流程，不写事实源/);
  assert.match(runtime, /单项失败只形成 `partial`，不能把整批标为成功/);
  assert.match(runtime, /该执行层与 Task acceptance gate 独立/);
});

test('the docs manifest routes curation apply to its owners', () => {
  const manifest = read('template/skills/agent-harness/docs/manifest.yaml');

  assert.match(manifest, /curation-apply/);
  assert.match(manifest, /策展执行/);
});

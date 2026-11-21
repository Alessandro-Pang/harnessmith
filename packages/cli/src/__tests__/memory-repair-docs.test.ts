import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

const stagedProtocol =
  /diagnose-only → content-bound proposal → explicit apply → independent verifier/;

test('memory-contracts reference owns the staged repair protocol and its safety fields', () => {
  const reference = read('template/skills/agent-harness/docs/references/memory-contracts.md');

  assert.match(reference, /`memory repair` 必须按/);
  assert.match(reference, stagedProtocol);
  assert.match(
    reference,
    /partial initialization.*core index.*derived index.*orphan marker.*interrupted transaction restore/s,
  );
  assert.match(
    reference,
    /proposal 记录 authority、精确目标、backup\/recovery、前置条件、风险和 verifier/,
  );
  assert.match(reference, /apply 同时要求精确\s+`--proposal` 与 `--yes`/);
  assert.match(
    reference,
    /active lock 直接拒绝，stale\s+lock 只能由同一 typed lock acquisition 回收/,
  );
  assert.match(reference, /unknown、ownerless.*保持 `inconclusive`/s);
});

test('CLI architecture core defers repair fields and state machines to the owner', () => {
  const architecture = read('template/skills/agent-harness/docs/core/harness-cli-architecture.md');

  assert.match(architecture, /Memory repair 只在对应 owner 中定义/);
  assert.match(architecture, stagedProtocol);
  assert.match(architecture, /本文件不复制这些字段和状态机/);
  assert.doesNotMatch(architecture, /--proposal|--yes/);
});

test('public runtime CLI reference documents diagnose-only repair with explicit bounded apply', () => {
  const runtimeCli = read('apps/docs/site/zh/reference/runtime-cli.md');

  assert.match(runtimeCli, /`memory repair` 默认是零写入诊断/);
  assert.match(runtimeCli, /--proposal <sha256:\.\.\.> --yes/);
  assert.match(
    runtimeCli,
    /authority、精确影响路径、backup\/recovery path、前置条件、风险和 verifier/,
  );
  assert.match(runtimeCli, /没有通用 `clean`/);
  assert.match(runtimeCli, /unknown files.*无 owner identity.*inconclusive/s);
  assert.match(runtimeCli, /active locks 会拒绝操作/);
  assert.match(runtimeCli, /typed lock/);
});

test('llms.txt keeps the repair protocol safe for non-interactive agents', () => {
  const llms = read('llms.txt');

  assert.match(llms, /`memory repair` is diagnose-only by default/);
  assert.match(
    llms,
    /Apply exactly one content-bound repair with both\s+`--proposal <sha256:\.\.\.> --yes`/,
  );
  assert.match(llms, /never substitute a generic clean command/);
  assert.match(
    llms,
    /Unknown files, ownerless markers or\s+backups.*remain unchanged and\s+`inconclusive`/s,
  );
  assert.match(
    llms,
    /exact paths, authority, backup\/recovery, risk, prerequisites, and an independent\s+verifier/,
  );
  assert.match(
    llms,
    /Active locks fail closed; stale locks are handled only by the typed lock acquisition contract/,
  );
});

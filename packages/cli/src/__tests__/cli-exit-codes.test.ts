import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import lockfile from 'proper-lockfile';
import { onTestFinished, test } from 'vitest';

const packageRoot = dirname(dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url))))));
const cli = join(packageRoot, 'bin', 'harnessmith.mjs');

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex-home'),
    HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
    HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
    HARNESS_REPOSITORY_ROOT: root,
    HARNESS_OWNER: 'cli-exit-code-test',
  };
  return { root, env };
}

function run(root: string, env: NodeJS.ProcessEnv, args: string[]) {
  return spawnSync(process.execPath, [cli, ...args], { cwd: root, env, encoding: 'utf8' });
}

function assertTextAndJsonExitCode(
  root: string,
  env: NodeJS.ProcessEnv,
  args: string[],
  code: string,
  exitCode: number,
) {
  const text = run(root, env, args);
  const json = run(root, env, [...args, '--json']);

  assert.equal(json.status, exitCode, json.stderr);
  const report = JSON.parse(json.stderr);
  assert.equal(report.error.code, code);
  assert.equal(report.error.exitCode, exitCode);
  assert.equal(text.status, exitCode, `${text.stdout}\n${text.stderr}`);
}

test('real bin maps Commander failures to CLI_USAGE in text and JSON modes', () => {
  const { root, env } = fixture('harnessmith-bin-usage-exit-');
  assertTextAndJsonExitCode(
    root,
    env,
    ['install', '--agent', 'codex', '--unknown'],
    'CLI_USAGE',
    2,
  );
});

test('real bin maps safety refusals to SAFETY_CONFLICT in text and JSON modes', () => {
  const { root, env } = fixture('harnessmith-bin-safety-exit-');
  mkdirSync(env.CODEX_HOME as string, { recursive: true });
  writeFileSync(join(env.CODEX_HOME as string, 'AGENTS.md'), 'unmanaged rules\n');

  assertTextAndJsonExitCode(
    root,
    env,
    ['install', '--agent', 'codex', '--no-init-global'],
    'SAFETY_CONFLICT',
    3,
  );
});

test('real bin maps missing lifecycle state to STATE_CONFLICT in text and JSON modes', () => {
  const { root, env } = fixture('harnessmith-bin-state-exit-');
  assertTextAndJsonExitCode(
    root,
    env,
    ['restore', '--agent', 'codex', '--yes'],
    'STATE_CONFLICT',
    5,
  );
});

test('real bin maps contended operations to OPERATION_LOCKED in text and JSON modes', () => {
  const { root, env } = fixture('harnessmith-bin-lock-exit-');
  const installed = run(root, env, ['install', '--agent', 'codex', '--no-init-global']);
  assert.equal(installed.status, 0, `${installed.stdout}\n${installed.stderr}`);
  const codexHome = env.CODEX_HOME as string;
  const release = lockfile.lockSync(codexHome, {
    lockfilePath: join(codexHome, '.harnessmith-operation.lock'),
    realpath: false,
    retries: 0,
  });
  try {
    assertTextAndJsonExitCode(
      root,
      env,
      ['install', '--agent', 'codex', '--no-init-global'],
      'OPERATION_LOCKED',
      4,
    );
  } finally {
    release();
  }
});

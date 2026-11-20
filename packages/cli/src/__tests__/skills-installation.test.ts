import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { onTestFinished, test } from 'vitest';
import { run } from '../cli.js';
import type { Io } from '../shared/types.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-skills-install-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex-home'),
    HARNESS_STATE_HOME: join(root, 'state'),
    HARNESS_MEMORY_HOME: join(root, 'memory'),
    HARNESS_PERSONAL_HOME: join(root, 'rules'),
    HARNESS_REPOSITORY_ROOT: root,
    HARNESS_OWNER: 'skills-install-test',
    DISABLE_TELEMETRY: '1',
  };
  delete env.HARNESS_HOME;
  return { root, env };
}

async function executeResult(env: NodeJS.ProcessEnv, args: string[]) {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: Io = {
    log: (message = '', ...optional) => logs.push([message, ...optional].join(' ')),
    error: (message = '', ...optional) => errors.push([message, ...optional].join(' ')),
  };
  const status = await run(args, {
    env,
    io,
    input: new PassThrough(),
    output: new PassThrough(),
  });
  return { status, logs, errors };
}

async function execute(env: NodeJS.ProcessEnv, args: string[]) {
  const result = await executeResult(env, args);
  assert.equal(result.status, 0, [...result.logs, ...result.errors].join('\n'));
  return result;
}

test('install and uninstall delegate the matching skill to skills and only render AGENTS.md in the host', async () => {
  const { root, env } = fixture();
  const skill = join(root, '.agents', 'skills', 'agent-harness');
  const hostEntry = join(root, 'codex-home', 'AGENTS.md');
  const formerHub = join(root, '.agents', 'harnessmith');

  await execute(env, ['install', '--agent', 'codex', '--no-init-global', '--yes']);

  assert.equal(existsSync(join(skill, 'SKILL.md')), true);
  assert.equal(existsSync(join(skill, 'scripts', 'harness.mjs')), false);
  assert.equal(existsSync(join(skill, 'dist')), false);
  assert.doesNotMatch(readFileSync(join(skill, 'SKILL.md'), 'utf8'), /\{\{HARNESS_/);
  assert.match(
    readFileSync(join(skill, 'SKILL.md'), 'utf8'),
    new RegExp(root.replaceAll(/[.*+?^${}()|[\]\\]/g, '\\$&')),
  );
  assert.equal(existsSync(join(root, '.harnessmith', 'dist')), false);
  assert.equal(existsSync(join(root, '.harnessmith', 'scripts')), false);
  assert.equal(lstatSync(hostEntry).isSymbolicLink(), false);
  assert.match(readFileSync(hostEntry, 'utf8'), /`harnessmith`/);
  assert.equal(existsSync(formerHub), false);

  await execute(env, ['uninstall', '--agent', 'codex', '--yes']);

  assert.equal(existsSync(skill), false);
  assert.equal(existsSync(hostEntry), false);
  assert.equal(existsSync(formerHub), false);
});

test('a refused uninstall leaves both the skill and modified instructions untouched', async () => {
  const { root, env } = fixture();
  const skill = join(root, '.agents', 'skills', 'agent-harness');
  const hostEntry = join(root, 'codex-home', 'AGENTS.md');
  await execute(env, ['install', '--agent', 'codex', '--no-init-global', '--yes']);
  writeFileSync(hostEntry, `${readFileSync(hostEntry, 'utf8')}\nlocal edit\n`);

  const result = await executeResult(env, ['uninstall', '--agent', 'codex', '--yes', '--json']);

  assert.notEqual(result.status, 0);
  assert.match(result.errors.join('\n'), /modified/i);
  assert.ok(existsSync(join(skill, 'SKILL.md')));
  assert.match(readFileSync(hostEntry, 'utf8'), /local edit/);
});

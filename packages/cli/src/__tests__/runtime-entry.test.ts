import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PassThrough } from 'node:stream';
import { onTestFinished, test } from 'vitest';
import { run } from '../cli.js';
import type { Io } from '../shared/types.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-runtime-entry-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: root,
    CODEX_HOME: join(root, 'codex-home'),
    HARNESS_MEMORY_HOME: join(root, 'agent-docs'),
    HARNESS_PERSONAL_HOME: join(root, 'personal-harness'),
    HARNESS_REPOSITORY_ROOT: root,
    HARNESS_OWNER: 'runtime-entry-test',
  };
  delete env.HARNESS_HOME;
  return { root, env };
}

function capturedIo() {
  const logs: string[] = [];
  const errors: string[] = [];
  const io: Io = {
    log: (message = '', ...optional) => logs.push([message, ...optional].join(' ')),
    error: (message = '', ...optional) => errors.push([message, ...optional].join(' ')),
  };
  return { logs, errors, io };
}

function context(env: NodeJS.ProcessEnv, io: Io) {
  return { env, io, input: new PassThrough(), output: new PassThrough() };
}

test('global CLI executes its bundled Runtime without an installation or managed hub', async () => {
  const { root, env } = fixture();
  const output = capturedIo();

  const status = await run(['version', '--json'], context(env, output.io));

  assert.equal(status, 0, output.errors.join('\n'));
  assert.deepEqual(output.errors, []);
  const report = JSON.parse(output.logs.join('\n'));
  assert.equal(report.harnessVersion, '3.0.0');
  assert.equal(report.schemaVersion, 3);
  assert.equal(existsSync(join(root, '.agents', 'harnessmith')), false);
});

test('global CLI preserves Runtime-specific commands and options', async () => {
  const { root, env } = fixture();
  const output = capturedIo();

  const status = await run(
    ['bootstrap', '--project', root, '--detail', 'brief', '--json'],
    context(env, output.io),
  );

  assert.equal(status, 0, output.errors.join('\n'));
  const report = JSON.parse(output.logs.join('\n'));
  assert.equal(report.project.root, root);
  assert.equal(existsSync(join(root, '.agents', 'harnessmith')), false);
});

test('global options may precede a Runtime command', async () => {
  const { env } = fixture();
  const output = capturedIo();

  const status = await run(['--json', 'version'], context(env, output.io));

  assert.equal(status, 0, output.errors.join('\n'));
  assert.equal(JSON.parse(output.logs.join('\n')).harnessVersion, '3.0.0');
});

test('global Runtime help names the harnessmith executable', async () => {
  const { env } = fixture();
  const output = capturedIo();

  const status = await run(['health', '--help'], context(env, output.io));

  assert.equal(status, 0, output.errors.join('\n'));
  assert.match(output.logs.join('\n'), /Usage: harnessmith health/);
});

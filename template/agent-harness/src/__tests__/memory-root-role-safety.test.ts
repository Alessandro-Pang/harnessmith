import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal, initProject } from '../commands/init.js';
import { captureInput } from '../commands/memory-input.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project);
  execFileSync('git', ['-C', project, 'init', '-q']);
  const memoryHome = join(project, '.agent-docs');
  return { project, memoryHome, runtime: { ...harnessRuntime(root), memoryHome } };
}

test('a missing global root cannot be initialized through the project memory role', () => {
  const { project, memoryHome, runtime } = fixture('harness-memory-role-missing-');

  assert.throws(
    () =>
      captureInput(
        runtime,
        project,
        { title: 'Wrong root role', content: 'Do not create project layout here.', source: 'chat' },
        capturedIo(),
      ),
    /project memory root collides with global memory/i,
  );
  assert.equal(existsSync(memoryHome), false);
  assert.equal(existsSync(join(project, '.gitignore')), false);
  assert.equal(existsSync(join(project, '.ignore')), false);
});

test('an existing global root cannot be reinterpreted as project memory', () => {
  const { project, memoryHome, runtime } = fixture('harness-memory-role-existing-');
  initGlobal(runtime, capturedIo());
  const core = readFileSync(join(memoryHome, 'core.md'), 'utf8');

  assert.throws(
    () => initProject(runtime, project, capturedIo()),
    /project memory root collides with global memory/i,
  );
  assert.equal(readFileSync(join(memoryHome, 'core.md'), 'utf8'), core);
  assert.equal(existsSync(join(project, '.gitignore')), false);
  assert.equal(existsSync(join(project, '.ignore')), false);
});

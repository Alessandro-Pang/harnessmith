import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { validateInstructionPath } from '../lib/filesystem/instruction-path.js';

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-instruction-path-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('instruction paths must be absolute and stay inside the authorized home', () => {
  const root = temporaryRoot();
  const home = join(root, 'host');
  mkdirSync(home, { recursive: true });

  assert.equal(validateInstructionPath(home, 'AGENTS.md').valid, false);
  assert.equal(validateInstructionPath('host', join(home, 'AGENTS.md')).valid, false);
  const outside = validateInstructionPath(home, join(root, 'outside', 'AGENTS.md'));
  assert.equal(outside.valid, false);
  assert.match(outside.valid ? '' : outside.reason, /escapes the managed home/);
});

test('instruction paths reject symlink components, including dangling links', () => {
  const root = temporaryRoot();
  const home = join(root, 'host');
  const instruction = join(home, 'entry', 'AGENTS.md');
  mkdirSync(dirname(instruction), { recursive: true });

  symlinkSync(join(root, 'removed', 'AGENTS.md'), instruction);
  const dangling = validateInstructionPath(home, instruction);
  assert.equal(dangling.valid, false);
  assert.match(dangling.valid ? '' : dangling.reason, /symbolic link/i);

  rmSync(instruction);
  writeFileSync(join(root, 'outside.md'), '# outside\n');
  symlinkSync(join(root, 'outside.md'), instruction);
  const retargetable = validateInstructionPath(home, instruction);
  assert.equal(retargetable.valid, false);
  assert.match(retargetable.valid ? '' : retargetable.reason, /symbolic link/i);
});

test('regular instruction paths are accepted and missing files are left to the caller', () => {
  const root = temporaryRoot();
  const home = join(root, 'host');
  const instruction = join(home, 'entry', 'AGENTS.md');
  mkdirSync(dirname(instruction), { recursive: true });
  writeFileSync(instruction, '# rules\n');

  assert.deepEqual(validateInstructionPath(home, instruction), { valid: true });
  assert.deepEqual(validateInstructionPath(home, join(home, 'missing', 'AGENTS.md')), {
    valid: true,
  });
});

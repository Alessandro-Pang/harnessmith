import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, onTestFinished, test, vi } from 'vitest';
import { applyMigration } from '../lib/memory/memory-migration-apply.js';
import { validateMemoryPreflight } from '../lib/memory/memory-preflight.js';

const validationControl = vi.hoisted(() => ({
  documentFailure: undefined as unknown,
  documentLog: '',
  rootLog: '',
  rootDiagnostic: undefined as string | undefined,
}));

vi.mock('../lib/memory/memory-validation.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../lib/memory/memory-validation.js')>();
  return {
    ...original,
    validateMemoryRoot: (...args: Parameters<typeof original.validateMemoryRoot>) => {
      if (validationControl.rootLog) args[1].log(validationControl.rootLog);
      if (validationControl.rootDiagnostic) {
        args[1].error('Display wording may change', {
          memoryDiagnosticCode: validationControl.rootDiagnostic,
        });
        throw new Error('Memory check failed');
      }
    },
    validateMemoryDocument: (...args: Parameters<typeof original.validateMemoryDocument>) => {
      if (validationControl.documentLog) args[3].log(validationControl.documentLog);
      if (validationControl.documentFailure !== undefined) throw validationControl.documentFailure;
      return 0;
    },
  };
});

beforeEach(() => {
  validationControl.documentFailure = undefined;
  validationControl.documentLog = '';
  validationControl.rootLog = '';
  validationControl.rootDiagnostic = undefined;
});

function migrationFixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-migration-callbacks-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const source = join(root, 'note.md');
  const content = 'before\n';
  writeFileSync(source, content);
  chmodSync(source, 0o600);
  return { content, root, source };
}

test('memory preflight ignores informational validator output', () => {
  validationControl.rootLog = 'Memory check passed';

  assert.doesNotThrow(() => validateMemoryPreflight('/virtual-memory-root', 'project'));
});

test('memory preflight classifies repairable failures by diagnostic code, not display text', () => {
  validationControl.rootDiagnostic = 'input-identity';

  assert.doesNotThrow(() =>
    validateMemoryPreflight('/virtual-memory-root', 'project', {
      allowInputIdentityDiagnostics: true,
    }),
  );
});

test('migration post-validation treats warning logs as non-blocking', () => {
  const { content, root, source } = migrationFixture();
  validationControl.rootLog = 'WARNING Root advisory';
  validationControl.documentLog = 'WARNING Document advisory';

  applyMigration(
    root,
    'project',
    source,
    'after\n',
    {
      exists: true,
      content,
      mode: 0o600,
    },
    [],
  );

  assert.equal(readFileSync(source, 'utf8'), 'after\n');
});

test('migration rolls back when document validation throws a non-Error value', () => {
  const { content, root, source } = migrationFixture();
  validationControl.documentFailure = 'document validation interrupted';

  assert.throws(
    () =>
      applyMigration(
        root,
        'project',
        source,
        'after\n',
        { exists: true, content, mode: 0o600 },
        [],
      ),
    /rolled back/i,
  );
  assert.equal(readFileSync(source, 'utf8'), content);
});

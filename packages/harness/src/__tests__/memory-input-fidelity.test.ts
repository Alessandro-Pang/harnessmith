import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { memoryCheck } from '../commands/memory/memory.js';
import { captureInput, maximumInputContentBytes } from '../commands/memory/memory-input.js';
import { closeInput } from '../commands/memory/memory-input-close.js';
import { archiveMemory } from '../commands/memory/memory-lifecycle.js';
import { reconcileProfile, removeProfileEntry } from '../commands/memory/memory-profile.js';
import { parseFrontmatterDocument } from '../lib/documentation/frontmatter.js';
import { parseInputBody } from '../lib/memory/memory-input.js';
import { withProjectMemoryTransaction } from '../lib/project/project-memory.js';
import { assertMode, capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  return { root, project, runtime: harnessRuntime(root) };
}

test('verbatim input preserves whitespace and compatibility Unicode in identity and storage', () => {
  const { project, runtime } = fixture('harness-input-verbatim-fidelity-');
  const angstromSign = '  indented\r\n\u212b value  ';
  const latinAngstrom = '  indented\r\n\u00c5 value  ';
  const first = captureInput(runtime, project, {
    title: 'Exact Angstrom sign',
    content: angstromSign,
    source: 'chat',
  });
  const second = captureInput(runtime, project, {
    title: 'Exact Latin Angstrom',
    content: latinAngstrom,
    source: 'chat',
  });

  const parsed = parseInputBody(parseFrontmatterDocument(readFileSync(first.path, 'utf8')).body);
  assert.equal(parsed?.content, angstromSign);
  assert.notEqual(first.path, second.path);
  assert.notEqual(
    readFileSync(first.path, 'utf8').match(/^content-digest: (.+)$/m)?.[1],
    readFileSync(second.path, 'utf8').match(/^content-digest: (.+)$/m)?.[1],
  );
});

test('content files must be bounded regular files and direct content uses the same byte limit', () => {
  const { root, project, runtime } = fixture('harness-input-content-boundary-');
  const target = join(root, 'target.txt');
  const link = join(root, 'payload-link.txt');
  const oversized = join(root, 'oversized.txt');
  writeFileSync(target, 'safe payload');
  symlinkSync(target, link, 'file');
  writeFileSync(oversized, Buffer.alloc(maximumInputContentBytes + 1, 0x61));

  assert.throws(
    () =>
      captureInput(runtime, project, {
        title: 'Symlink payload',
        contentFile: link,
        source: 'file',
      }),
    /regular non-symlink file/i,
  );
  assert.throws(
    () =>
      captureInput(runtime, project, {
        title: 'Oversized file payload',
        contentFile: oversized,
        source: 'file',
      }),
    /exceeds .* bytes/i,
  );
  assert.throws(
    () =>
      captureInput(runtime, project, {
        title: 'Oversized direct payload',
        content: 'a'.repeat(maximumInputContentBytes + 1),
        source: 'chat',
      }),
    /bounded reliable summary/i,
  );
});

test('project memory initialization leaves host ignore files untouched', () => {
  const { project, runtime } = fixture('harness-input-ignore-mode-');
  const gitignore = join(project, '.gitignore');
  writeFileSync(gitignore, 'existing-rule\n');
  chmodSync(gitignore, 0o600);

  captureInput(runtime, project, {
    title: 'Initialize memory safely',
    content: 'Preserve the ignore file mode.',
    source: 'chat',
  });

  assertMode(gitignore, 0o600);
  assert.equal(readFileSync(gitignore, 'utf8'), 'existing-rule\n');
  assert.equal(readFileSync(join(project, '.agent-docs', '.gitignore'), 'utf8'), '*\n');
});

test('failed input capture rolls back project ignore initialization side effects', () => {
  const { project, runtime } = fixture('harness-input-init-rollback-');
  const baseline = 'existing-rule\n';
  const gitignore = join(project, '.gitignore');
  const ignore = join(project, '.ignore');
  writeFileSync(gitignore, baseline);
  writeFileSync(ignore, baseline);
  chmodSync(gitignore, 0o600);
  chmodSync(ignore, 0o640);
  captureInput(runtime, project, {
    title: 'Initialize baseline memory',
    content: 'Create the managed scaffolding.',
    source: 'chat',
  });
  writeFileSync(gitignore, baseline);
  writeFileSync(ignore, baseline);
  const core = join(project, '.agent-docs', 'core.md');
  writeFileSync(core, readFileSync(core, 'utf8').replace('## Important Inputs', '## Missing'));

  assert.throws(
    () =>
      captureInput(runtime, project, {
        title: 'Must roll back initialization',
        content: 'This write must fail.',
        source: 'chat',
      }),
    /memory core|managed section layout/i,
  );
  assert.equal(readFileSync(gitignore, 'utf8'), baseline);
  assert.equal(readFileSync(ignore, 'utf8'), baseline);
  assertMode(gitignore, 0o600);
  assertMode(ignore, 0o640);
});

test('project transaction never recursively deletes a concurrent sentinel', () => {
  const { project, runtime } = fixture('harness-project-transaction-sentinel-');
  let sentinel = '';

  assert.throws(
    () =>
      withProjectMemoryTransaction(runtime, project, ({ memoryRoot }) => {
        sentinel = join(memoryRoot, 'sentinel.txt');
        writeFileSync(sentinel, 'external state\n');
        throw new Error('force rollback');
      }),
    /force rollback/i,
  );
  assert.equal(readFileSync(sentinel, 'utf8'), 'external state\n');
  assert.equal(existsSync(join(project, '.gitignore')), false);
  assert.equal(existsSync(join(project, '.ignore')), false);
});

test('profile keys have one shared 100-character command and validation boundary', () => {
  const { runtime } = fixture('harness-profile-key-boundary-');
  const acceptedKey = 'a'.repeat(100);
  const created = reconcileProfile(runtime, {
    key: acceptedKey,
    conclusion: 'A bounded stable profile dimension.',
    evidence: 'explicit',
    confidence: 'high',
  });
  const before = readFileSync(created.path, 'utf8');

  assert.throws(
    () =>
      reconcileProfile(runtime, {
        key: 'b'.repeat(101),
        conclusion: 'This key must be rejected.',
        evidence: 'explicit',
        confidence: 'high',
      }),
    /1-100 characters/i,
  );
  assert.equal(readFileSync(created.path, 'utf8'), before);

  writeFileSync(created.path, before.replace(acceptedKey, 'c'.repeat(101)));
  const validation = capturedIo();
  assert.throws(() => memoryCheck(runtime, 'global', validation), /issue/i);
  assert.match(validation.errors.join('\n'), /invalid user-profile entry/i);
});

test('profile removal forgets every duplicate occurrence of one exact key', () => {
  const { runtime } = fixture('harness-profile-remove-duplicates-');
  const created = reconcileProfile(runtime, {
    key: 'communication.private',
    conclusion: 'Remove this completely.',
    evidence: 'explicit',
    confidence: 'high',
  });
  const content = readFileSync(created.path, 'utf8');
  const entry = content.match(/^- communication\.private \|.+$/m)?.[0];
  assert.ok(entry);
  writeFileSync(created.path, `${content.replace(/\n+$/, '')}\n${entry}\n`);

  const removed = removeProfileEntry(runtime, { key: 'communication.private' }, capturedIo());

  assert.equal(removed.action, 'updated');
  assert.doesNotMatch(readFileSync(created.path, 'utf8'), /^- communication\.private \|/m);
});

test('typed input validation requires its digest and parseable capture body', () => {
  const { project, runtime } = fixture('harness-input-schema-marker-');
  const created = captureInput(runtime, project, {
    title: 'Typed input schema',
    content: 'Keep the identity invariant enforceable.',
    source: 'chat',
  });
  const withoutDigest = readFileSync(created.path, 'utf8').replace(/^content-digest: .+\n/m, '');
  writeFileSync(created.path, withoutDigest);

  const missingDigest = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, missingDigest), /issue/i);
  assert.match(missingDigest.errors.join('\n'), /typed input.*content-digest/i);

  writeFileSync(created.path, withoutDigest.replace('# 原始输入', '# Arbitrary body'));
  const invalidBody = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, invalidBody), /issue/i);
  assert.match(invalidBody.errors.join('\n'), /typed input.*capture body/i);
});

test('input schema v2 requires purpose, retention, and a workstream binding when scoped', () => {
  const { project, runtime } = fixture('harness-input-policy-schema-');
  const created = captureInput(runtime, project, {
    title: 'Scoped policy',
    content: 'Keep this constraint for the current workstream.',
    source: 'chat',
    mode: 'verbatim',
    purpose: 'constraint',
    retention: 'workstream',
    workstream: 'memory-input-quality',
  });
  const valid = readFileSync(created.path, 'utf8');

  writeFileSync(created.path, valid.replace(/^input-purpose: .+\n/m, ''));
  const missingPurpose = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, missingPurpose), /issue/i);
  assert.match(missingPurpose.errors.join('\n'), /input schema v2.*purpose/i);

  writeFileSync(created.path, valid.replace(/^workstream: .+\n/m, ''));
  const missingWorkstream = capturedIo();
  assert.throws(() => memoryCheck(runtime, project, missingWorkstream), /issue/i);
  assert.match(missingWorkstream.errors.join('\n'), /workstream.*required/i);
});

test('repeated capture finds an archived input without reviving or reindexing it', () => {
  const { project, runtime } = fixture('harness-input-archived-identity-');
  const options = {
    title: 'Archived semantic input',
    content: 'Keep one semantic identity across lifecycle moves.',
    source: 'chat' as const,
  };
  const created = captureInput(runtime, project, options, capturedIo());
  const corePath = join(project, '.agent-docs', 'core.md');
  writeFileSync(
    corePath,
    readFileSync(corePath, 'utf8')
      .split('\n')
      .filter((line) => !line.includes(created.reference))
      .join('\n'),
  );
  closeInput(runtime, project, created.reference, { reason: 'consumed' }, capturedIo());
  const archivedPath = archiveMemory(runtime, project, created.reference, {}, capturedIo());
  const archived = readFileSync(archivedPath, 'utf8');
  const core = readFileSync(corePath, 'utf8');

  const repeated = captureInput(runtime, project, options, capturedIo());

  assert.equal(repeated.action, 'unchanged');
  assert.equal(repeated.path, archivedPath);
  assert.equal(readFileSync(archivedPath, 'utf8'), archived);
  assert.equal(readFileSync(corePath, 'utf8'), core);
  assert.doesNotMatch(core, new RegExp(created.reference));
});

test('repeated input capture canonicalizes case and dot-segment index aliases', () => {
  const { project, runtime } = fixture('harness-input-reference-repair-');
  const options = {
    title: 'Canonical input route',
    content: 'Repair only the existing semantic input route.',
    source: 'chat' as const,
  };
  const created = captureInput(runtime, project, options, capturedIo());
  const corePath = join(project, '.agent-docs', 'core.md');
  const aliases = [
    `memory:${created.reference.slice('memory:'.length).toUpperCase()}`,
    created.reference.replace('memory:inputs/', 'memory:./inputs/'),
  ];

  for (const alias of aliases) {
    writeFileSync(corePath, readFileSync(corePath, 'utf8').replace(created.reference, alias));
    const repaired = captureInput(runtime, project, options, capturedIo());
    assert.equal(repaired.action, 'updated');
    assert.match(readFileSync(corePath, 'utf8'), new RegExp(created.reference));
    assert.doesNotMatch(readFileSync(corePath, 'utf8'), new RegExp(alias.replaceAll('.', '\\.')));
  }
});

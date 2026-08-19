import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { inspectProject } from '../commands/project.js';
import {
  atomicWrite,
  atomicWriteMany,
  listFiles,
  sameText,
  shortDigest,
  writeIfMissing,
} from '../lib/files.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { gitRoot, gitVersion } from '../lib/git.js';
import { projectSnapshot } from '../lib/project.js';
import { searchableFiles, textSearch } from '../lib/search.js';
import { render } from '../lib/templates.js';
import { calendarDate, createRuntime, timestamp } from '../runtime.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function temporaryRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

test('file primitives preserve existing content and return deterministic discovery', () => {
  const root = temporaryRoot('harness-libs-');
  const first = join(root, 'nested', 'a.md');
  const second = join(root, 'b.yaml');
  atomicWrite(first, 'alpha\n');
  assert.equal(writeIfMissing(first, 'replaced\n'), false);
  assert.equal(readFileSync(first, 'utf8'), 'alpha\n');
  assert.equal(writeIfMissing(second, 'beta\n'), true);
  assert.deepEqual(listFiles(root), [second, first].sort());
  assert.equal(sameText(first, 'alpha\n'), true);
  assert.match(shortDigest(first), /^[a-f0-9]{12}$/);
});

test('multi-file writes restore earlier files when a later write fails', () => {
  const root = temporaryRoot('harness-files-rollback-');
  const first = join(root, 'first.md');
  const invalid = join(root, 'directory');
  writeFileSync(first, 'original\n');
  mkdirSync(invalid);

  assert.throws(() =>
    atomicWriteMany([
      { path: first, content: 'changed\n' },
      { path: invalid, content: 'cannot replace a directory\n' },
    ]),
  );
  assert.equal(readFileSync(first, 'utf8'), 'original\n');
});

test('frontmatter parsing handles valid, absent, and malformed YAML', () => {
  const metadata = parseFrontmatter('---\ntitle: Test\nsource-of-truth: false\n---\n\nBody\n');
  assert.equal(metadata.get('title'), 'Test');
  assert.equal(metadata.get('source-of-truth'), false);
  assert.equal(parseFrontmatter('Body only').size, 0);
  assert.equal(parseFrontmatter('---\ntitle: unfinished').size, 0);
  assert.throws(() => parseFrontmatter('---\nvalue: [\n---\n'), /flow sequence|end of the stream/i);
});

test('search discovers supported text formats once and reports matching lines', () => {
  const root = temporaryRoot('harness-search-');
  writeFileSync(join(root, 'one.md'), 'Alpha\nneedle here\n');
  writeFileSync(join(root, 'two.yml'), 'value: NEEDLE\n');
  writeFileSync(join(root, 'skip.txt'), 'needle\n');
  const io = capturedIo();
  assert.deepEqual(
    searchableFiles([root, root]).map((path) => basename(path)),
    ['one.md', 'two.yml'],
  );
  assert.equal(textSearch('needle', [root], io), 2);
  assert.equal(io.logs.length, 2);
  assert.match(io.logs[0], /one\.md:2:needle here/);
});

test('runtime rendering keeps unknown tokens and formats stable dates', () => {
  const root = temporaryRoot('harness-runtime-');
  const runtime = harnessRuntime(root);
  const content = render(
    runtime,
    '{{HARNESS_OWNER}}|{{HARNESS_HOME}}|{{DATE}}|{{EXTRA}}|{{UNKNOWN}}',
    { EXTRA: 'value' },
  );
  assert.equal(
    content,
    `test-owner|${runtime.harnessHome}|${calendarDate(runtime)}|value|{{UNKNOWN}}`,
  );
  assert.equal(calendarDate(runtime, new Date('2026-08-19T23:59:59Z')), '2026-08-19');
  assert.equal(timestamp(new Date('2026-08-19T01:02:03.456Z')), '2026-08-19T010203-456Z');

  const created = createRuntime({
    HOME: join(root, 'custom-home'),
    HARNESS_HOME: join(root, 'custom-harness'),
    HARNESS_MEMORY_HOME: join(root, 'custom-memory'),
    HARNESS_REPOSITORY_ROOT: join(root, 'custom-repositories'),
    HARNESS_OWNER: 'custom-owner',
  });
  assert.equal(created.owner, 'custom-owner');
  assert.equal(created.memoryHome, join(root, 'custom-memory'));
  assert.equal(Object.isFrozen(created), true);
});

test('project snapshot reports Git, package manager, manifests, and nearest instructions', () => {
  const root = temporaryRoot('harness-project-');
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'checkout', '-q', '-b', 'feature/20260819_test']);
  writeFileSync(join(root, 'package-lock.json'), '{}\n');
  writeFileSync(join(root, 'package.json'), '{"scripts":{"test":"vitest","build":"tsup"}}\n');
  writeFileSync(join(root, 'AGENTS.md'), '# Rules\n');
  mkdirSync(join(root, 'src'));
  const snapshot = projectSnapshot(join(root, 'src'));
  assert.equal(gitRoot(root), realpathSync(root));
  assert.match(gitVersion() ?? '', /^git version /);
  assert.equal(snapshot.isGitRepository, true);
  assert.equal(snapshot.branch, 'feature/20260819_test');
  assert.equal(snapshot.packageManager, 'npm');
  assert.deepEqual(snapshot.packageScripts, ['build', 'test']);
  assert.deepEqual(snapshot.manifests, ['package.json']);
  assert.deepEqual(snapshot.agents, [join(root, 'AGENTS.md')]);
  assert.equal(snapshot.dirty, true);
  assert.equal(gitRoot(join(root, 'missing')), null);

  const output = capturedIo();
  const inspected = inspectProject(root, { json: true }, output);
  assert.equal(inspected.root, realpathSync(root));
  assert.equal((JSON.parse(output.logs[0]) as { packageManager: string }).packageManager, 'npm');
});

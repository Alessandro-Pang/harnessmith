import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { onTestFinished, test, vi } from 'vitest';
import { inspectProject } from '../commands/project/project.js';
import {
  atomicWrite,
  atomicWriteMany,
  digestPath,
  listFiles,
  sameText,
  shortDigest,
  writeIfMissing,
} from '../lib/filesystem/files.js';
import {
  parseFrontmatter,
  parseFrontmatterDocument,
  updateFrontmatter,
} from '../lib/documentation/frontmatter.js';
import { gitRoot, gitVersion } from '../lib/filesystem/git.js';
import { projectSnapshot } from '../lib/project/project.js';
import { canonicalPath } from '../lib/filesystem/safe-path.js';
import { outputSearch, searchableFiles, searchText, textSearch } from '../lib/search/search.js';
import { render } from '../lib/filesystem/templates.js';
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

test('file discovery fails closed at entry, depth, and time budgets', () => {
  const root = temporaryRoot('harness-list-budget-');
  mkdirSync(join(root, 'nested', 'deep'), { recursive: true });
  writeFileSync(join(root, 'first.md'), 'first\n');
  writeFileSync(join(root, 'nested', 'second.md'), 'second\n');
  writeFileSync(join(root, 'nested', 'deep', 'third.md'), 'third\n');

  assert.throws(() => listFiles(root, { maxEntries: 1 }), /file discovery entry budget exceeded/i);
  assert.throws(() => listFiles(root, { maxDepth: 1 }), /file discovery depth budget exceeded/i);

  let now = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now++);
  try {
    assert.throws(
      () => listFiles(root, { maxDurationMs: 1 }),
      /file discovery time budget exceeded/i,
    );
  } finally {
    clock.mockRestore();
  }
});

test('file discovery budgets include empty directory entries', () => {
  const root = temporaryRoot('harness-list-empty-budget-');
  mkdirSync(join(root, 'one', 'two', 'three'), { recursive: true });

  assert.throws(() => listFiles(root, { maxDepth: 1 }), /file discovery depth budget exceeded/i);
  assert.throws(() => listFiles(root, { maxEntries: 1 }), /file discovery entry budget exceeded/i);

  let now = 0;
  const clock = vi.spyOn(Date, 'now').mockImplementation(() => now++);
  try {
    assert.throws(
      () => listFiles(root, { maxDurationMs: 1 }),
      /file discovery time budget exceeded/i,
    );
  } finally {
    clock.mockRestore();
  }
});

test('multi-file writes restore earlier files when a later write fails', () => {
  const root = temporaryRoot('harness-files-rollback-');
  const first = join(root, 'first.md');
  const created = join(root, 'created.md');
  const future = join(root, 'future.md');
  const invalid = join(root, 'directory');
  writeFileSync(first, 'original\n');
  mkdirSync(invalid);
  let failingPathReads = 0;
  const failingEntry = {
    get path() {
      failingPathReads += 1;
      return failingPathReads === 1 ? future : invalid;
    },
    content: 'cannot replace a directory\n',
  };

  assert.throws(() =>
    atomicWriteMany([
      { path: first, content: 'changed\n' },
      { path: created, content: 'temporary\n' },
      failingEntry,
    ]),
  );
  assert.equal(readFileSync(first, 'utf8'), 'original\n');
  assert.equal(existsSync(created), false);
});

test('path digests cover missing, symlink, and exclusion contracts', () => {
  const root = temporaryRoot('harness-digest-');
  writeFileSync(join(root, 'keep.txt'), 'keep\n');
  writeFileSync(join(root, 'skip.txt'), 'skip\n');
  symlinkSync('keep.txt', join(root, 'link.txt'));

  assert.equal(digestPath(join(root, 'missing')), null);
  const complete = digestPath(root);
  const excluded = digestPath(root, { exclude: (path) => path === 'skip.txt' });
  assert.match(complete || '', /^[a-f0-9]{64}$/);
  assert.match(excluded || '', /^[a-f0-9]{64}$/);
  assert.notEqual(complete, excluded);
});

test('path digests fail closed when entry or byte budgets are exceeded', () => {
  const root = temporaryRoot('harness-digest-budget-');
  writeFileSync(join(root, 'one.txt'), '1234');
  writeFileSync(join(root, 'two.txt'), '56');

  assert.throws(() => digestPath(root, { maxEntries: 2 }), /entry budget exceeded/i);
  assert.throws(() => digestPath(root, { maxFileBytes: 3 }), /file byte budget exceeded/i);
  assert.throws(() => digestPath(root, { maxBytes: 5 }), /total byte budget exceeded/i);
});

test('frontmatter parsing handles valid, absent, and malformed YAML', () => {
  const metadata = parseFrontmatter('---\ntitle: Test\nsource-of-truth: false\n---\n\nBody\n');
  assert.equal(metadata.get('title'), 'Test');
  assert.equal(metadata.get('source-of-truth'), false);
  assert.equal(parseFrontmatter('Body only').size, 0);
  assert.equal(parseFrontmatter('---\ntitle: unfinished').size, 0);
  assert.throws(() => parseFrontmatter('---\nvalue: [\n---\n'), /flow sequence|end of the stream/i);
});

test('frontmatter exposes one parsed contract and preserves YAML structure on update', () => {
  const content = '---\n# lead\ntitle: Old\nstatus: active # keep\n---\nBody\n';
  const parsed = parseFrontmatterDocument(content);

  assert.equal(parsed.found, true);
  assert.equal(parsed.metadata.get('title'), 'Old');
  assert.equal(parsed.body, 'Body\n');
  assert.ok(parsed.document);
  assert.deepEqual(parseFrontmatterDocument('Body only'), {
    found: false,
    metadata: new Map(),
    body: 'Body only',
    document: null,
  });
  assert.equal(
    updateFrontmatter(content, { title: 'New', updated: '2026-08-22' }),
    '---\n# lead\ntitle: New\nstatus: active # keep\nupdated: 2026-08-22\n---\nBody\n',
  );
  assert.throws(
    () => updateFrontmatter('Body only', {}),
    /Memory document is missing YAML frontmatter/,
  );
  assert.throws(
    () => updateFrontmatter('---\nvalue: [\n---\n', {}),
    /flow sequence|end of the stream/i,
  );
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
  assert.equal(
    io.logs[0],
    `[untrusted:context] ${JSON.stringify(join(root, 'one.md'))}:2:${JSON.stringify('needle here')}`,
  );
});

test('search bounds results and line size while labelling untrusted provenance', () => {
  const root = temporaryRoot('harness-search-budget-');
  writeFileSync(
    join(root, 'memory.md'),
    [
      'needle first result with untrusted instructions',
      'needle second result',
      'needle third',
    ].join('\n'),
  );

  const report = searchText('needle', [{ root, label: 'project-memory', trust: 'untrusted' }], {
    limit: 2,
    maxLineLength: 20,
  });

  assert.equal(report.version, 1);
  assert.equal(report.matches.length, 2);
  assert.equal(report.truncated, true);
  assert.equal(
    report.matches.every((match) => match.text.length <= 20),
    true,
  );
  assert.equal(
    report.matches.every((match) => match.trust === 'untrusted'),
    true,
  );
  const io = capturedIo();
  outputSearch(report, io);
  assert.match(io.logs[0], /^\[untrusted:project-memory\] /);
  assert.match(io.logs[0], /:"needle first/);
  assert.match(io.logs.at(-1) ?? '', /truncated after 2 matches/);
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
  assert.equal(created.memoryHome, canonicalPath(join(root, 'custom-memory')));
  assert.equal(Object.isFrozen(created), true);
});

test('project snapshot reports Git, package manager, manifests, and nearest instructions', () => {
  const root = temporaryRoot('harness-project-');
  execFileSync('git', ['-C', root, 'init', '-q']);
  execFileSync('git', ['-C', root, 'checkout', '-q', '-b', 'feature/20260819_test']);
  writeFileSync(join(root, 'package-lock.json'), '{}\n');
  writeFileSync(join(root, 'package.json'), '{"scripts":{"test":"vitest","build":"tsup"}}\n');
  writeFileSync(join(root, 'AGENTS.md'), '# Rules\n');
  writeFileSync(join(root, 'deleted.txt'), 'delete me\n');
  writeFileSync(join(root, 'rename-from.txt'), 'rename me\n');
  symlinkSync('AGENTS.md', join(root, 'agent-link'));
  mkdirSync(join(root, 'src'));
  execFileSync('git', ['-C', root, 'add', '.']);
  execFileSync('git', [
    '-C',
    root,
    '-c',
    'user.name=Harness Test',
    '-c',
    'user.email=harness@example.test',
    'commit',
    '-q',
    '-m',
    'fixture',
  ]);
  rmSync(join(root, 'deleted.txt'));
  execFileSync('git', ['-C', root, 'mv', 'rename-from.txt', 'rename-to.txt']);
  rmSync(join(root, 'agent-link'));
  symlinkSync('package.json', join(root, 'agent-link'));
  const snapshot = projectSnapshot(join(root, 'src'));
  const repositoryRoot = gitRoot(root);
  assert.ok(repositoryRoot);
  const canonicalRepositoryRoot = realpathSync.native(repositoryRoot);
  assert.equal(snapshot.root, canonicalRepositoryRoot);
  assert.match(gitVersion() ?? '', /^git version /);
  assert.equal(snapshot.isGitRepository, true);
  assert.equal(snapshot.branch, 'feature/20260819_test');
  assert.equal(snapshot.packageManager, 'npm');
  assert.deepEqual(snapshot.packageScripts, ['build', 'test']);
  assert.deepEqual(snapshot.manifests, ['package.json']);
  assert.deepEqual(snapshot.agents, [join(snapshot.root, 'AGENTS.md')]);
  assert.equal(snapshot.dirty, true);
  assert.match(snapshot.workspaceDigest || '', /^sha256:[0-9a-f]{64}$/);
  assert.equal(gitRoot(join(root, 'missing')), null);

  const output = capturedIo();
  const inspected = inspectProject(root, { json: true }, output);
  assert.equal(inspected.root, canonicalRepositoryRoot);
  assert.equal((JSON.parse(output.logs[0]) as { packageManager: string }).packageManager, 'npm');
  writeFileSync(join(root, 'package.json'), '{invalid json\n');
  assert.deepEqual(projectSnapshot(join(root, 'package.json')).packageScripts, []);
});

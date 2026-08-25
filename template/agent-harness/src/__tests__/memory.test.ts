import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
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
import lockfile from 'proper-lockfile';
import { onTestFinished, test } from 'vitest';
import { initGlobal, initPersonal, initProject } from '../commands/init.js';
import { memoryCheck, memoryList, memorySearch, resolveMemoryRoot } from '../commands/memory.js';
import { contextSearch } from '../commands/search.js';
import { parseFrontmatter } from '../lib/frontmatter.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function memoryDocument(title: string, body = '', newline = '\n'): string {
  return [
    '---',
    `title: ${title}`,
    `description: ${title} memory`,
    'type: session-handoff',
    'memory-kind: episode',
    'status: active',
    'owners: [test-owner]',
    'created: 2026-08-19',
    'updated: 2026-08-19',
    'project: test',
    'tags: [test]',
    'scope: []',
    'source-refs: []',
    'source-of-truth: false',
    'schema-version: 1',
    '---',
    '',
    body,
    '',
  ].join(newline);
}

test('global memory initialization is idempotent and preserves user content', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  const first = capturedIo();
  initGlobal(runtime, first);
  assert.match(first.logs[0], /Initialized global memory/);
  const core = join(runtime.memoryHome, 'core.md');
  writeFileSync(core, `${readFileSync(core, 'utf8')}\nuser note\n`);

  const second = capturedIo();
  initGlobal(runtime, second);
  assert.match(second.logs[0], /already initialized/);
  assert.match(readFileSync(core, 'utf8'), /user note/);
  assert.equal(resolveMemoryRoot(runtime, 'global'), runtime.memoryHome);
});

test('global memory initialization repairs the profile route in a preserved legacy core', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const core = join(runtime.memoryHome, 'core.md');
  writeFileSync(
    core,
    readFileSync(core, 'utf8').replace(
      /## User Profile[\s\S]*?其余跨项目记忆/,
      '当前没有需要主动路由的跨项目记忆。\n\n其余跨项目记忆',
    ),
  );
  writeFileSync(core, `${readFileSync(core, 'utf8')}\nuser-owned note\n`);

  initGlobal(runtime, capturedIo());

  const repaired = readFileSync(core, 'utf8');
  assert.match(repaired, /memory:profile/);
  assert.match(repaired, /user-owned note/);
  assert.doesNotThrow(() => memoryCheck(runtime, 'global', capturedIo(), { indexed: true }));
});

test('global memory initialization participates in the shared root lock', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  mkdirSync(runtime.memoryHome, { recursive: true });
  const release = lockfile.lockSync(runtime.memoryHome, { realpath: false });
  onTestFinished(() => release());

  assert.throws(() => initGlobal(runtime, capturedIo()), /memory is being updated/i);
  assert.equal(existsSync(join(runtime.memoryHome, 'core.md')), false);
});

test('global memory initializes a compact user profile and routes to it from core', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);

  initGlobal(runtime, capturedIo());

  const profile = join(runtime.memoryHome, 'profile.md');
  assert.equal(existsSync(profile), true);
  assert.match(readFileSync(profile, 'utf8'), /type: user-profile/);
  assert.match(readFileSync(profile, 'utf8'), /memory-kind: distilled/);
  assert.match(readFileSync(join(runtime.memoryHome, 'core.md'), 'utf8'), /memory:profile/);
  memoryCheck(runtime, 'global', capturedIo());
});

test('personal overlay initialization is idempotent and preserves user rules', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initPersonal(runtime, capturedIo());
  const rules = join(runtime.personalHome, 'AGENTS.md');
  writeFileSync(rules, `${readFileSync(rules, 'utf8')}\nuser rule\n`);
  initPersonal(runtime, capturedIo());
  assert.match(readFileSync(rules, 'utf8'), /user rule/);
  assert.ok(readFileSync(join(runtime.personalHome, 'projects', 'repository-map.md'), 'utf8'));
  assert.ok(readFileSync(join(runtime.personalHome, 'projects', 'repository-map.yaml'), 'utf8'));
});

test('personal overlay initialization rejects concurrent writers', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  mkdirSync(runtime.personalHome, { recursive: true });
  const release = lockfile.lockSync(runtime.personalHome, { realpath: false });
  onTestFinished(() => release());

  assert.throws(() => initPersonal(runtime, capturedIo()), /personal overlay is being updated/i);
  assert.equal(existsSync(join(runtime.personalHome, 'AGENTS.md')), false);
});

test('project initialization targets the Git root and manages both ignore files once', () => {
  const root = temporaryRoot();
  const project = join(root, 'project');
  const nested = join(project, 'packages', 'app');
  mkdirSync(nested, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  writeFileSync(join(project, '.gitignore'), 'node_modules/\n');
  const runtime = harnessRuntime(root);

  initProject(runtime, nested, capturedIo());
  initProject(runtime, nested, capturedIo());
  for (const name of ['.gitignore', '.ignore']) {
    const content = readFileSync(join(project, name), 'utf8');
    assert.equal(content.match(/^\/\.agent-docs\/$/gm)?.length, 1);
  }
  const metadata = parseFrontmatter(readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8'));
  assert.equal(metadata.get('project'), 'project');
  assert.throws(() => initProject(runtime, join(root, 'missing')), /does not exist/);
});

test('project initialization rejects a symlinked memory root', () => {
  const root = temporaryRoot();
  const project = join(root, 'project');
  const outside = join(root, 'outside');
  mkdirSync(project, { recursive: true });
  mkdirSync(outside, { recursive: true });
  symlinkSync(outside, join(project, '.agent-docs'), 'dir');

  assert.throws(
    () => initProject(harnessRuntime(root), project, capturedIo()),
    /symbolic link|symlink/i,
  );
  assert.equal(existsSync(join(outside, 'README.md')), false);
  assert.equal(existsSync(join(outside, 'core.md')), false);
});

test('project memory ignores local host-evaluation artifacts', () => {
  const root = temporaryRoot();
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  const artifacts = join(project, '.agent-docs', 'host-evals', 'runs', 'run-1');
  mkdirSync(artifacts, { recursive: true });
  writeFileSync(
    join(artifacts, 'transcript.md'),
    '# Redacted transcript\n\nisolated-host-eval-marker\n',
  );
  writeFileSync(join(artifacts, 'host-output.txt'), 'x'.repeat(1024 * 1024 + 1));

  assert.doesNotThrow(() => memoryCheck(runtime, project, capturedIo(), { indexed: true }));
  const listed = memoryList(runtime, project, capturedIo(), { json: true });
  assert.equal(
    listed.documents.some(({ path }) => path.startsWith('host-evals/')),
    false,
  );
  const searched = capturedIo();
  assert.equal(memorySearch(runtime, project, 'isolated-host-eval-marker', searched), 1);
  assert.equal(
    searched.logs.some((line) => line.includes('host-evals')),
    false,
  );
});

test('project initialization participates in the project memory root lock', () => {
  const root = temporaryRoot();
  const project = join(root, 'project');
  const memoryRoot = join(project, '.agent-docs');
  mkdirSync(memoryRoot, { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const release = lockfile.lockSync(memoryRoot, { realpath: false });
  onTestFinished(() => release());

  assert.throws(
    () => initProject(harnessRuntime(root), project, capturedIo()),
    /memory is being updated/i,
  );
  assert.equal(existsSync(join(memoryRoot, 'core.md')), false);
  assert.equal(existsSync(join(project, '.gitignore')), false);
});

test('memory list, search, and reference validation handle archive and broken references', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const note = join(runtime.memoryHome, 'episode.md');
  writeFileSync(note, memoryDocument('Episode', 'Needle memory:core', '\r\n'));
  mkdirSync(join(runtime.memoryHome, '_archive'));
  writeFileSync(
    join(runtime.memoryHome, '_archive', 'old.md'),
    memoryDocument('Old', 'ArchiveOnlyNeedle').replace('status: active', 'status: archived'),
  );

  const listed = capturedIo();
  memoryList(runtime, 'global', listed);
  assert.equal(
    listed.logs.some((line) => line.includes('_archive')),
    false,
  );
  assert.equal(
    listed.logs.some((line) => line.includes('episode.md | episode')),
    true,
  );
  assert.equal(memorySearch(runtime, 'global', 'needle', capturedIo()), 0);
  assert.equal(memorySearch(runtime, 'global', 'archiveonlyneedle', capturedIo()), 1);
  assert.equal(memorySearch(runtime, 'global', 'absent', capturedIo()), 1);
  assert.throws(() => memorySearch(runtime, 'global', ''), /Usage/);
  memoryCheck(runtime, 'global', capturedIo());

  writeFileSync(note, `${readFileSync(note, 'utf8')}\nmemory:missing-note\n`);
  const invalid = capturedIo();
  assert.throws(() => memoryCheck(runtime, 'global', invalid), /1 issue/);
  assert.match(invalid.errors[0], /Broken memory reference/);
});

test('indexed memory check rejects active documents that core cannot reach', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const note = join(runtime.memoryHome, 'episode.md');
  writeFileSync(note, memoryDocument('Episode'));

  const orphaned = capturedIo();
  assert.throws(() => memoryCheck(runtime, 'global', orphaned, { indexed: true }), /issue/);
  assert.equal(
    orphaned.errors.some((message) => /not reachable from an index/.test(message)),
    true,
  );

  const core = join(runtime.memoryHome, 'core.md');
  writeFileSync(core, `${readFileSync(core, 'utf8')}\n- Episode memory:episode\n`);
  assert.doesNotThrow(() => memoryCheck(runtime, 'global', capturedIo(), { indexed: true }));
});

test('indexed memory check requires initialized entry files and core-rooted reachability', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  mkdirSync(runtime.memoryHome);
  const missing = capturedIo();
  assert.throws(() => memoryCheck(runtime, 'global', missing, { indexed: true }), /issue/);
  assert.match(missing.errors.join('\n'), /Required memory entry is missing: core\.md/);

  rmSync(runtime.memoryHome, { recursive: true });
  initGlobal(runtime, capturedIo());
  writeFileSync(join(runtime.memoryHome, 'episode.md'), memoryDocument('Episode'));
  writeFileSync(
    join(runtime.memoryHome, 'orphan-index.md'),
    memoryDocument('Orphan index', 'memory:episode').replace(
      'memory-kind: episode',
      'memory-kind: index',
    ),
  );
  const orphaned = capturedIo();
  assert.throws(() => memoryCheck(runtime, 'global', orphaned, { indexed: true }), /2 issue/);
  assert.match(orphaned.errors.join('\n'), /orphan-index\.md/);
  assert.match(orphaned.errors.join('\n'), /episode\.md/);

  const core = join(runtime.memoryHome, 'core.md');
  writeFileSync(core, `${readFileSync(core, 'utf8')}\n- Nested index memory:orphan-index\n`);
  assert.doesNotThrow(() => memoryCheck(runtime, 'global', capturedIo(), { indexed: true }));
});

test('memory check enforces metadata types, schema version, and real calendar dates', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const invalid = memoryDocument('Invalid')
    .replace('owners: [test-owner]', 'owners: test-owner')
    .replace('created: 2026-08-19', 'created: 2026-02-30')
    .replace('schema-version: 1', 'schema-version: 2');
  writeFileSync(join(runtime.memoryHome, 'invalid.md'), invalid);
  const output = capturedIo();

  assert.throws(() => memoryCheck(runtime, 'global', output), /issue/);
  assert.equal(
    output.errors.some((message) => /owners must be an array/.test(message)),
    true,
  );
  assert.equal(
    output.errors.some((message) => /Invalid created date/.test(message)),
    true,
  );
  assert.equal(
    output.errors.some((message) => /Unsupported memory schema/.test(message)),
    true,
  );
});

test('memory check enforces kind lifecycle links, unique sessions, and secret hygiene', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const first = memoryDocument('First', '-----BEGIN OPENSSH PRIVATE KEY-----')
    .replace('type: session-handoff', 'type: user-input')
    .replace('memory-kind: episode', 'memory-kind: input')
    .replace('status: active', 'status: superseded')
    .replace('schema-version: 1', 'session-id: duplicate-session\nschema-version: 1');
  const second = memoryDocument('Second').replace(
    'schema-version: 1',
    'session-id: duplicate-session\nschema-version: 1',
  );
  writeFileSync(join(runtime.memoryHome, 'first.md'), first);
  writeFileSync(join(runtime.memoryHome, 'second.md'), second);
  const output = capturedIo();

  assert.throws(() => memoryCheck(runtime, 'global', output), /issue/);
  assert.equal(
    output.errors.some((message) => /input-source/.test(message)),
    true,
  );
  assert.equal(
    output.errors.some((message) => /superseded-by/.test(message)),
    true,
  );
  assert.equal(
    output.errors.some((message) => /Duplicate session-id/.test(message)),
    true,
  );
  assert.equal(
    output.errors.some((message) => /secret material/.test(message)),
    true,
  );
});

test('memory check rejects duplicate, malformed, and oversized user-profile entries', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  const entries = Array.from(
    { length: 33 },
    (_, index) => `- interests.topic-${index} | Topic ${index} | observed | medium | 2026-08-20`,
  );
  entries[1] = '- interests.topic-0 | Conflicting topic | explicit | high | 2026-08-20';
  entries[2] = '- malformed entry';
  writeFileSync(
    profile,
    memoryDocument('User Profile', `# Current Profile\n\n${entries.join('\n')}`)
      .replace('type: session-handoff', 'type: user-profile')
      .replace('memory-kind: episode', 'memory-kind: distilled')
      .replace('project: test', 'project: global'),
  );
  const output = capturedIo();

  assert.throws(() => memoryCheck(runtime, 'global', output), /issue/);
  assert.equal(
    output.errors.some((message) => /at most 32 active entries/.test(message)),
    true,
  );
  assert.equal(
    output.errors.some((message) => /Duplicate user-profile key/.test(message)),
    true,
  );
  assert.equal(
    output.errors.some((message) => /Invalid user-profile entry/.test(message)),
    true,
  );
});

test('memory check enforces profile.md as the single canonical user profile', () => {
  const root = temporaryRoot();
  const runtime = harnessRuntime(root);
  initGlobal(runtime, capturedIo());
  const profile = join(runtime.memoryHome, 'profile.md');
  const duplicate = join(runtime.memoryHome, 'other-profile.md');
  writeFileSync(duplicate, readFileSync(profile, 'utf8'));
  const duplicateOutput = capturedIo();

  assert.throws(() => memoryCheck(runtime, 'global', duplicateOutput), /issue/);
  assert.equal(
    duplicateOutput.errors.some((message) => /must be stored at profile\.md/.test(message)),
    true,
  );

  rmSync(duplicate);
  writeFileSync(
    profile,
    readFileSync(profile, 'utf8').replace('type: user-profile', 'type: memory'),
  );
  const wrongTypeOutput = capturedIo();
  assert.throws(() => memoryCheck(runtime, 'global', wrongTypeOutput), /issue/);
  assert.equal(
    wrongTypeOutput.errors.some((message) =>
      /profile\.md must declare type user-profile/.test(message),
    ),
    true,
  );
});

test('context search combines Harness, global memory, project memory, and project docs', () => {
  const root = temporaryRoot();
  const project = join(root, 'project');
  mkdirSync(join(project, 'docs'), { recursive: true });
  writeFileSync(join(project, 'docs', 'architecture.md'), '# UniqueContextNeedle\n');
  const runtime = harnessRuntime(root, { docsRoot: join(project, 'empty-docs') });
  assert.equal(contextSearch(runtime, 'uniquecontextneedle', project, capturedIo()), 0);
  assert.equal(contextSearch(runtime, 'not-present-anywhere', project, capturedIo()), 1);
});

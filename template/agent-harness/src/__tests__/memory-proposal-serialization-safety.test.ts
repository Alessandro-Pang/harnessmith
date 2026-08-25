import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { initGlobal, initProject } from '../commands/init.js';
import { memoryMigrate } from '../commands/memory-migration.js';
import { memoryPromotionProposal } from '../commands/memory-promotion.js';
import { maximumMemoryDocumentBytes } from '../lib/memory-path.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-memory-proposal-safety-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  const memoryRoot = join(project, '.agent-docs');
  mkdirSync(join(memoryRoot, 'distilled'), { recursive: true });
  execFileSync('git', ['-C', project, 'init', '-q']);
  const runtime = harnessRuntime(root);
  initProject(runtime, project, capturedIo());
  return { root, project, memoryRoot, runtime };
}

function secret(): string {
  return ['ghp', '_', 'a'.repeat(24)].join('');
}

function distilledDocument({
  title = 'Finding',
  description = 'Finding memory',
  sourceRefs = [],
}: {
  title?: string;
  description?: string;
  sourceRefs?: string[];
} = {}): string {
  return [
    '---',
    `title: ${title}`,
    `description: ${description}`,
    'type: distilled-memory',
    'memory-kind: distilled',
    'status: active',
    'owners: [test-owner]',
    'created: 2026-08-25',
    'updated: 2026-08-25',
    'project: project',
    'tags: [test]',
    'scope: []',
    ...(sourceRefs.length > 0
      ? ['source-refs:', ...sourceRefs.map((value) => `  - ${value}`)]
      : ['source-refs: []']),
    'source-of-truth: false',
    'schema-version: 1',
    '---',
    '',
    'Finding body.',
    '',
  ].join('\n');
}

test('migration rejects high-confidence secrets at any nested metadata depth before reporting', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'core.md');
  const before = readFileSync(source, 'utf8');
  const io = capturedIo();
  const metadata = JSON.stringify({
    safe: {
      nested: [{ deeper: { credential: secret() } }],
    },
  });

  assert.throws(
    () => memoryMigrate(runtime, 'global', 'core', metadata, { json: true }, io),
    /migration metadata.*high-confidence secret/i,
  );
  assert.deepEqual(io.logs, []);
  assert.equal(readFileSync(source, 'utf8'), before);
});

test('migration source and malformed request diagnostics never serialize secret material', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'broken.md');
  const token = secret();
  const malformed = `---\ntitle: [${token}\n---\n`;

  for (const apply of [false, true]) {
    writeFileSync(source, malformed);
    const io = capturedIo();
    let message = '';
    try {
      memoryMigrate(runtime, 'global', 'broken', '{}', { apply, json: true }, io);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    assert.match(message, /migration source.*secret|invalid memory migration source/i);
    assert.doesNotMatch(message, new RegExp(token));
    assert.doesNotMatch([...io.logs, ...io.errors].join('\n'), new RegExp(token));
    assert.equal(readFileSync(source, 'utf8'), malformed);
  }

  const requestIo = capturedIo();
  let requestMessage = '';
  try {
    memoryMigrate(runtime, 'global', 'core', `{"description":"${token}`, { json: true }, requestIo);
  } catch (error) {
    requestMessage = error instanceof Error ? error.message : String(error);
  }
  assert.match(requestMessage, /migration request.*secret|migration metadata.*secret/i);
  assert.doesNotMatch(requestMessage, new RegExp(token));
  assert.deepEqual(requestIo.logs, []);
});

test('migration never copies a secret legacy status into proposed updates', () => {
  const { runtime } = fixture();
  initGlobal(runtime, capturedIo());
  const source = join(runtime.memoryHome, 'core.md');
  const token = secret();
  const before = readFileSync(source, 'utf8').replace(/^status: active$/m, `status: ${token}`);
  writeFileSync(source, before);
  const io = capturedIo();
  let message = '';

  try {
    memoryMigrate(
      runtime,
      'global',
      'core',
      JSON.stringify({ status: 'active' }),
      { json: true },
      io,
    );
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /migration source.*secret/i);
  assert.doesNotMatch(message, new RegExp(token));
  assert.doesNotMatch(io.logs.join('\n'), new RegExp(token));
  assert.equal(readFileSync(source, 'utf8'), before);
});

test('promotion rejects secrets in every serialized metadata field before logging', () => {
  const { project, memoryRoot, runtime } = fixture();
  const path = join(memoryRoot, 'distilled', 'finding.md');
  const cases = [{ title: secret() }, { description: secret() }, { sourceRefs: [secret()] }];

  for (const metadata of cases) {
    writeFileSync(path, distilledDocument(metadata));
    const io = capturedIo();
    assert.throws(
      () => memoryPromotionProposal(runtime, project, 'distilled/finding', 'docs/finding.md', io),
      /promotion proposal.*high-confidence secret|memory preflight failed/i,
    );
    assert.deepEqual(io.logs, []);
  }
});

test('promotion rejects a secret-bearing request target before serializing its path', () => {
  const { project, memoryRoot, runtime } = fixture();
  writeFileSync(join(memoryRoot, 'distilled', 'finding.md'), distilledDocument());
  const token = secret();
  const io = capturedIo();
  let message = '';

  try {
    memoryPromotionProposal(runtime, project, 'distilled/finding', `docs/${token}.md`, io);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /promotion request.*high-confidence secret/i);
  assert.doesNotMatch(message, new RegExp(token));
  assert.doesNotMatch(io.logs.join('\n'), new RegExp(token));
});

test('promotion preflight redacts a malformed secret-bearing source document', () => {
  const { project, memoryRoot, runtime } = fixture();
  const token = secret();
  writeFileSync(join(memoryRoot, 'distilled', 'finding.md'), `---\ntitle: [${token}\n---\n`);
  const io = capturedIo();
  let message = '';

  try {
    memoryPromotionProposal(runtime, project, 'distilled/finding', 'docs/finding.md', io);
  } catch (error) {
    message = error instanceof Error ? error.message : String(error);
  }
  assert.match(message, /memory preflight failed|promotion source/i);
  assert.doesNotMatch(message, new RegExp(token));
  assert.doesNotMatch([...io.logs, ...io.errors].join('\n'), new RegExp(token));
});

test('promotion bounds memory reads before parsing frontmatter', () => {
  const { project, memoryRoot, runtime } = fixture();
  const path = join(memoryRoot, 'distilled', 'finding.md');
  writeFileSync(path, distilledDocument());
  truncateSync(path, maximumMemoryDocumentBytes + 1);

  assert.throws(
    () =>
      memoryPromotionProposal(
        runtime,
        project,
        'distilled/finding',
        'docs/finding.md',
        capturedIo(),
      ),
    /memory document.*exceeds|byte budget/i,
  );
});

test('promotion preflights authoritative target paths against project symlinks', () => {
  const { root, project, memoryRoot, runtime } = fixture();
  writeFileSync(join(memoryRoot, 'distilled', 'finding.md'), distilledDocument());
  const outside = join(root, 'outside-docs');
  mkdirSync(outside);
  symlinkSync(outside, join(project, 'docs'), 'dir');

  assert.throws(
    () =>
      memoryPromotionProposal(
        runtime,
        project,
        'distilled/finding',
        'docs/finding.md',
        capturedIo(),
      ),
    /symbolic link|resolves outside/i,
  );
});

test('promotion validates the full managed root before serializing a proposal', () => {
  const { project, memoryRoot, runtime } = fixture();
  initProject(runtime, project, capturedIo());
  writeFileSync(join(memoryRoot, 'distilled', 'finding.md'), distilledDocument());
  writeFileSync(join(memoryRoot, 'invalid.md'), 'missing frontmatter\n');
  const io = capturedIo();

  assert.throws(
    () => memoryPromotionProposal(runtime, project, 'distilled/finding', 'docs/finding.md', io),
    /memory (?:check|preflight) failed/i,
  );
  assert.deepEqual(io.logs, []);
});

test('promotion rejects a global memory root reached through its parent path', () => {
  const { root } = fixture();
  const parent = join(root, 'global-parent');
  mkdirSync(parent, { recursive: true });
  const runtime = harnessRuntime(root, { memoryHome: join(parent, '.agent-docs') });
  initGlobal(runtime, capturedIo());

  assert.throws(
    () => memoryPromotionProposal(runtime, parent, 'profile', 'docs/profile.md', capturedIo()),
    /promotion requires a project memory scope/i,
  );
});

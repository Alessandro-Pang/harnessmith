import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { captureExperience } from '../commands/memory/memory-experience.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-experience-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['-C', root, 'init', '-q']);
  return { project: root, runtime: harnessRuntime(root) };
}

test('typed experience deduplicates one conclusion and accumulates sourced evidence', () => {
  const { project, runtime } = fixture();
  const capture = (evidence: string, sourceRef: string) => {
    const io = capturedIo();
    assert.equal(
      runCli(
        [
          'memory',
          'capture-experience',
          project,
          '--kind',
          'lesson',
          '--title',
          'Keep prompt rules atomic',
          '--conclusion',
          'Readable atomic rules are safer than byte-optimized prompt compression.',
          '--rationale',
          'Atomic rules preserve intent boundaries during prompt maintenance.',
          '--application',
          'Keep one enforceable constraint per routed owner document.',
          '--evidence',
          evidence,
          '--source-ref',
          sourceRef,
          '--json',
        ],
        { runtime, io },
      ),
      0,
      io.errors.join('\n'),
    );
    return JSON.parse(io.logs[0]);
  };
  const first = capture(
    'The compressed rule exceeded normal sentence complexity.',
    'docs/prompt-review.md',
  );
  const second = capture(
    'Natural-language routing regressed while regex tests stayed green.',
    'packages/harness/src/__tests__/docs-routing.test.ts',
  );

  assert.equal(first.action, 'created');
  assert.equal(second.action, 'updated');
  assert.equal(second.path, first.path);
  const document = readFileSync(first.path, 'utf8');
  assert.match(document, /^memory-kind: distilled$/m);
  assert.match(document, /^experience-kind: lesson$/m);
  assert.match(document, /^experience-schema-version: 2$/m);
  assert.match(document, /^document-purpose: Keep prompt rules atomic$/m);
  assert.match(document, /^document-purpose-schema-version: 1$/m);
  assert.match(document, /# 理由\n\nAtomic rules preserve intent boundaries/);
  assert.match(document, /# 应用\n\nKeep one enforceable constraint/);
  assert.match(document, /docs\/prompt-review\.md/);
  assert.match(document, /packages\/harness\/src\/__tests__\/docs-routing\.test\.ts/);
  assert.match(document, /compressed rule exceeded normal sentence complexity/);
  assert.match(document, /Natural-language routing regressed/);
  const core = readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8');
  assert.match(core, new RegExp(first.reference));
});

test('typed failure experience requires evidence and source references', () => {
  const { project, runtime } = fixture();
  assert.throws(
    () =>
      captureExperience(
        runtime,
        project,
        {
          kind: 'failure',
          title: 'Incomplete release exception',
          conclusion: 'A partial risk list must not authorize the complete evaluation matrix.',
          rationale: 'The omitted paths remain unverified.',
          application: 'Require the complete matrix before authorization.',
          evidence: [],
          sourceRefs: [],
        },
        capturedIo(),
      ),
    /evidence.*source references/i,
  );
});

test('experience source references reject absolute paths', () => {
  const { project, runtime } = fixture();
  assert.throws(
    () =>
      captureExperience(
        runtime,
        project,
        {
          kind: 'lesson',
          title: 'Keep source pointers bounded',
          conclusion: 'Experience sources must remain attributable to the project.',
          rationale: 'Absolute paths can expose unrelated host files.',
          application: 'Use project-relative paths or typed pointers.',
          evidence: ['The writer rejects absolute source paths.'],
          sourceRefs: ['/etc/passwd'],
        },
        capturedIo(),
      ),
    /source references must be project-relative/i,
  );
});

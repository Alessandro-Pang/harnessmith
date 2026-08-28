import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { captureExperience } from '../commands/memory-experience.js';
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
    'template/agent-harness/src/__tests__/docs-routing.test.ts',
  );

  assert.equal(first.action, 'created');
  assert.equal(second.action, 'updated');
  assert.equal(second.path, first.path);
  const document = readFileSync(first.path, 'utf8');
  assert.match(document, /^memory-kind: distilled$/m);
  assert.match(document, /^experience-kind: lesson$/m);
  assert.match(document, /docs\/prompt-review\.md/);
  assert.match(document, /template\/agent-harness\/src\/__tests__\/docs-routing\.test\.ts/);
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
          evidence: [],
          sourceRefs: [],
        },
        capturedIo(),
      ),
    /evidence.*source references/i,
  );
});

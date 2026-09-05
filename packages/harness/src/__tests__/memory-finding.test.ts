import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { captureFinding } from '../commands/memory/memory-finding.js';
import { findingDigest } from '../lib/memory/memory-finding.js';
import {
  validateExperienceSemantics,
  validateFindingDocument,
} from '../lib/memory/memory-finding-document-rules.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'harness-finding-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(root, { recursive: true });
  execFileSync('git', ['-C', root, 'init', '-q']);
  return { project: root, runtime: harnessRuntime(root) };
}

test('typed durable finding deduplicates a conclusion and accumulates evidence', () => {
  const { project, runtime } = fixture();
  const capture = (evidence: string, sourceRef: string) => {
    const io = capturedIo();
    assert.equal(
      runCli(
        [
          'memory',
          'capture-finding',
          project,
          '--kind',
          'analysis',
          '--retention',
          'durable',
          '--fact-class',
          'settled-fact',
          '--title',
          'Keep routing intent explicit',
          '--conclusion',
          'Playbook routing must distinguish requested actions from quoted task vocabulary.',
          '--rationale',
          'Vocabulary-only matching confuses examples and questions with mutation intent.',
          '--application',
          'Use action-aware matching for playbooks while keeping broad topic recall.',
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
    'A quoted review example selected the review playbook.',
    'docs/routing-qa.md',
  );
  const second = capture(
    'Action-aware routing keeps explicit analysis requests selectable.',
    'packages/harness/src/__tests__/docs-routing.test.ts',
  );
  const unchanged = capture(
    'Action-aware routing keeps explicit analysis requests selectable.',
    'packages/harness/src/__tests__/docs-routing.test.ts',
  );

  assert.equal(first.action, 'created');
  assert.equal(first.status, 'created');
  assert.equal(first.reasonCode, 'created-new-memory');
  assert.equal(second.action, 'updated');
  assert.equal(second.status, 'updated');
  assert.equal(second.reasonCode, 'updated-existing-memory');
  assert.equal(unchanged.action, 'unchanged');
  assert.equal(unchanged.status, 'unchanged');
  assert.equal(unchanged.reasonCode, 'unchanged-existing-memory');
  assert.equal(second.path, first.path);
  assert.equal(second.kind, 'distilled');
  const document = readFileSync(first.path, 'utf8');
  assert.match(document, /^type: analytical-finding$/m);
  assert.match(document, /^memory-kind: distilled$/m);
  assert.match(document, /^finding-kind: analysis$/m);
  assert.match(document, /^document-purpose: Keep routing intent explicit$/m);
  assert.match(document, /^document-purpose-schema-version: 1$/m);
  assert.match(document, /^retention: durable$/m);
  assert.match(document, /# 理由\n\nVocabulary-only matching/);
  assert.match(document, /# 应用\n\nUse action-aware matching/);
  assert.match(document, /docs\/routing-qa\.md/);
  assert.match(document, /packages\/harness\/src\/__tests__\/docs-routing\.test\.ts/);
  const core = readFileSync(join(project, '.agent-docs', 'core.md'), 'utf8');
  assert.match(core, new RegExp(first.reference));

  const checkIo = capturedIo();
  assert.equal(
    runCli(['memory', 'check', project, '--indexed', '--json'], { runtime, io: checkIo }),
    0,
    checkIo.errors.join('\n'),
  );
});

test('finding source references reject absolute and traversal paths', () => {
  const { project, runtime } = fixture();
  const base = {
    kind: 'analysis' as const,
    retention: 'durable' as const,
    factClass: 'settled-fact' as const,
    title: 'Reject unsafe source pointers',
    conclusion: 'Source references must remain attributable to the project.',
    rationale: 'Absolute and traversal paths escape the project boundary.',
    application: 'Keep only relative paths or typed pointers.',
    evidence: ['The writer validates source pointer boundaries.'],
  };
  assert.throws(
    () =>
      captureFinding(runtime, project, { ...base, sourceRefs: ['/tmp/secret.log'] }, capturedIo()),
    /source references must be project-relative/i,
  );
  assert.throws(
    () =>
      captureFinding(
        runtime,
        project,
        { ...base, sourceRefs: ['memory:../outside'] },
        capturedIo(),
      ),
    /memory source references must stay project-relative/i,
  );
});

test('the same purpose does not merge semantically different conclusions', () => {
  const { project, runtime } = fixture();
  const base = {
    kind: 'analysis' as const,
    retention: 'durable' as const,
    factClass: 'settled-fact' as const,
    title: 'Keep one canonical purpose',
    rationale: 'Purpose identifies intent while the conclusion digest identifies semantics.',
    application: 'Keep distinct conclusions as distinct documents.',
    evidence: ['Two conclusions can serve one stable purpose.'],
    sourceRefs: ['docs/purpose-contract.md'],
  };
  const first = captureFinding(
    runtime,
    project,
    { ...base, conclusion: 'The first conclusion remains independently reviewable.' },
    capturedIo(),
  );
  const second = captureFinding(
    runtime,
    project,
    { ...base, conclusion: 'The second conclusion remains independently reviewable.' },
    capturedIo(),
  );
  assert.notEqual(first.path, second.path);
});

test('finding payload schema fails closed and preserves an invalid payload', () => {
  const { project, runtime } = fixture();
  const payload = join(project, 'finding-payload.json');
  writeFileSync(
    payload,
    JSON.stringify({
      kind: 'analysis',
      retention: 'durable',
      factClass: 'settled-fact',
      title: 'Reject unknown payload fields',
      conclusion: 'Typed payloads must reject schema drift.',
      rationale: 'Unknown fields can silently bypass intended contracts.',
      application: 'Fail before any managed write.',
      evidence: ['The payload contains an unsupported field.'],
      sourceRefs: ['docs/payload-contract.md'],
      unexpected: true,
    }),
  );
  assert.throws(
    () =>
      runCli(
        ['memory', 'capture-finding', project, '--payload-file', payload, '--consume-payload-file'],
        { runtime, io: capturedIo() },
      ),
    /unknown.*unexpected|unexpected.*unknown/i,
  );
  assert.equal(existsSync(payload), true);
  assert.equal(existsSync(join(project, '.agent-docs')), false);
});

test('workstream finding requires a stable binding and explicit expiry', () => {
  const { project, runtime } = fixture();
  const base = {
    kind: 'research' as const,
    retention: 'workstream' as const,
    factClass: 'recovery-state' as const,
    title: 'Compare bounded search paths',
    conclusion: 'The candidate needs a reproducible bounded benchmark.',
    rationale: 'Architecture fit does not prove measured performance.',
    application: 'Persist corpus inputs and benchmark results for this workstream.',
    evidence: ['The current report contains no reproducible measurement.'],
    sourceRefs: ['docs/search-review.md'],
  };

  assert.throws(
    () => captureFinding(runtime, project, base, capturedIo()),
    /workstream.*required/i,
  );
  assert.throws(
    () =>
      captureFinding(
        runtime,
        project,
        { ...base, workstream: 'search-backend-selection' },
        capturedIo(),
      ),
    /expires.*required/i,
  );
  const result = captureFinding(
    runtime,
    project,
    { ...base, workstream: 'search-backend-selection', expires: '2026-09-30' },
    capturedIo(),
  );
  assert.equal(result.kind, 'working');
  const document = readFileSync(result.path, 'utf8');
  assert.match(document, /^memory-kind: working$/m);
  assert.match(document, /^workstream: search-backend-selection$/m);
  assert.match(document, /^expires: 2026-09-30$/m);
});

test('finding rejects incomplete semantics and secret-bearing evidence before initialization', () => {
  const { project, runtime } = fixture();
  const base = {
    kind: 'review' as const,
    retention: 'durable' as const,
    factClass: 'settled-fact' as const,
    title: 'Reject incomplete findings',
    conclusion: 'A finding needs reusable reasoning and application.',
    rationale: 'Without why, the conclusion cannot be evaluated.',
    application: 'Require complete typed fields.',
    evidence: ['Review identified the missing contract.'],
    sourceRefs: ['docs/review.md'],
  };
  assert.throws(
    () => captureFinding(runtime, project, { ...base, rationale: '' }, capturedIo()),
    /rationale.*required/i,
  );
  assert.throws(
    () =>
      captureFinding(
        runtime,
        project,
        { ...base, evidence: ['Authorization: Bearer ghp_abcdefghijklmnopqrstuvwxyz123456'] },
        capturedIo(),
      ),
    /secret/i,
  );
  assert.equal(existsSync(join(project, '.agent-docs')), false);
});

test('durable findings reject drifting state and preserve verifier pointers', () => {
  const { project, runtime } = fixture();
  const base = {
    kind: 'analysis' as const,
    retention: 'durable' as const,
    title: 'Recompute repository state',
    conclusion: 'Repository state must be recomputed before use.',
    rationale: 'A cached HEAD or test count drifts after every relevant change.',
    application: 'Run the verifier instead of trusting an earlier output.',
    evidence: ['The verifier is stable while its output is intentionally not retained.'],
    sourceRefs: ['verifier:git rev-parse HEAD'],
  };

  assert.throws(
    () => captureFinding(runtime, project, { ...base, factClass: 'current-state' }, capturedIo()),
    /current-state.*durable/i,
  );
  const result = captureFinding(
    runtime,
    project,
    { ...base, factClass: 'verification-pointer' },
    capturedIo(),
  );
  assert.match(readFileSync(result.path, 'utf8'), /^fact-class: verification-pointer$/m);
});

test('finding document validation explains malformed identity, content, and retention', () => {
  const body = '# 结论\n\nA reusable conclusion.\n\n# 证据\n\nEvidence without a list item.\n';
  const metadata = new Map<string, unknown>([
    ['type', 'legacy-finding'],
    ['finding-digest', 'sha256:stale'],
    ['finding-schema-version', 2],
    ['finding-kind', 'unknown'],
    ['source-refs', []],
    ['retention', 'workstream'],
    ['memory-kind', 'distilled'],
    ['workstream', 'bad workstream'],
    ['expires', '2026-02-30'],
  ]);
  const io = capturedIo();

  assert.equal(validateFindingDocument('finding.md', body, metadata, io), 10);
  assert.match(io.errors.join('\n'), /identity or schema/);
  assert.match(io.errors.join('\n'), /finding kind/);
  assert.match(io.errors.join('\n'), /valid fact class/);
  assert.match(io.errors.join('\n'), /source references/);
  assert.match(io.errors.join('\n'), /non-empty 理由/);
  assert.match(io.errors.join('\n'), /non-empty 应用/);
  assert.match(io.errors.join('\n'), /at least one list item/);
  assert.match(io.errors.join('\n'), /working memory/);
  assert.match(io.errors.join('\n'), /stable workstream/);
  assert.match(io.errors.join('\n'), /valid expiry/);

  const authorityIo = capturedIo();
  metadata.set('fact-class', 'formal-fact');
  validateFindingDocument('finding.md', body, metadata, authorityIo);
  assert.match(authorityIo.errors.join('\n'), /cannot declare formal fact authority/i);
});

test('finding document validation rejects drifted durable metadata and digest', () => {
  const conclusion = 'A reusable conclusion.';
  const body = `# 结论\n\n${conclusion}\n\n# 理由\n\nStable rationale.\n\n# 应用\n\nStable application.\n\n# 证据\n\n- Stable evidence.\n`;
  const metadata = new Map<string, unknown>([
    ['type', 'analytical-finding'],
    ['finding-schema-version', 1],
    ['finding-kind', 'analysis'],
    ['finding-digest', `sha256:${findingDigest('analysis', `${conclusion} changed`)}`],
    ['source-refs', ['docs/source.md']],
    ['retention', 'durable'],
    ['memory-kind', 'working'],
    ['workstream', 'unexpected'],
  ]);
  const io = capturedIo();

  assert.equal(validateFindingDocument('finding.md', body, metadata, io), 3);
  assert.match(io.errors.join('\n'), /digest does not match/);
  assert.match(io.errors.join('\n'), /distilled memory/);
  assert.match(io.errors.join('\n'), /must not declare workstream or expiry/);

  metadata.set('retention', 'unknown');
  const invalidRetentionIo = capturedIo();
  assert.equal(validateFindingDocument('finding.md', body, metadata, invalidRetentionIo), 2);
  assert.match(invalidRetentionIo.errors.join('\n'), /Invalid finding retention/);

  assert.equal(
    validateFindingDocument('note.md', body, new Map([['type', 'working-note']]), capturedIo()),
    0,
  );
});

test('experience semantic validation is versioned and requires reusable sections', () => {
  assert.equal(
    validateExperienceSemantics('note.md', '', new Map([['type', 'working-note']]), capturedIo()),
    0,
  );
  assert.equal(
    validateExperienceSemantics(
      'legacy.md',
      '',
      new Map([['type', 'operational-experience']]),
      capturedIo(),
    ),
    0,
  );

  const unsupportedIo = capturedIo();
  assert.equal(
    validateExperienceSemantics(
      'unsupported.md',
      '',
      new Map<string, unknown>([
        ['type', 'operational-experience'],
        ['experience-schema-version', 3],
      ]),
      unsupportedIo,
    ),
    1,
  );
  assert.match(unsupportedIo.errors.join('\n'), /Unsupported experience schema/);

  const incompleteIo = capturedIo();
  assert.equal(
    validateExperienceSemantics(
      'incomplete.md',
      '# 结论\n\nReusable conclusion.\n',
      new Map<string, unknown>([
        ['type', 'operational-experience'],
        ['experience-schema-version', 2],
      ]),
      incompleteIo,
    ),
    3,
  );
  assert.match(incompleteIo.errors.join('\n'), /non-empty 理由/);
  assert.match(incompleteIo.errors.join('\n'), /non-empty 应用/);
  assert.match(incompleteIo.errors.join('\n'), /non-empty 证据/);
});

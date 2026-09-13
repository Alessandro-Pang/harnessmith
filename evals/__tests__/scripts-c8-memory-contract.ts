import assert from 'node:assert/strict';
import { verifyMemoryContract } from '../../scripts/evaluation/memory/memory-contract-verifier.js';

const profile = (key: string, conclusion: string) =>
  `- ${key} | ${conclusion} | explicit | high | 2026-09-07\n`;
const doc = (meta: string) => `---\n${meta}\n---\nbody\n`;
const state = (global: Record<string, string> = {}, project: Record<string, string> = {}) => ({
  global,
  project,
});

export function coverMemoryContract(): void {
  const before = state({
    'profile.md':
      profile('communication.review-format', 'Conclusion first') +
      profile('coding.language', 'TypeScript'),
  });
  assert.equal(verifyMemoryContract({ before, after: before }).outcome, 'inconclusive');
  assert.equal(
    verifyMemoryContract({
      before,
      after: before,
      contract: { kind: 'no-write' },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before,
      after: state({ 'profile.md': profile('coding.language', 'TypeScript') }, { 'input.md': 'x' }),
      contract: { kind: 'no-write' },
    }).outcome,
    'failed',
  );
  assert.equal(
    verifyMemoryContract({
      before,
      after: state({
        'profile.md':
          profile('communication.review-format', 'Key risks only') +
          profile('coding.language', 'TypeScript'),
      }),
      contract: { kind: 'profile-update', key: 'communication.review-format' },
      semanticReview: { status: 'passed' },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before,
      after: state({
        'profile.md':
          profile('communication.review-format', 'Key risks only') +
          profile('coding.language', 'TypeScript'),
      }),
      contract: { kind: 'profile-update', key: 'communication.review-format' },
    }).outcome,
    'inconclusive',
  );
  assert.equal(
    verifyMemoryContract({
      before,
      after: state({
        'profile.md':
          profile('communication.review-format', 'Key risks only') +
          profile('coding.language', 'TypeScript'),
      }),
      contract: { kind: 'profile-update', key: 'communication.review-format' },
      semanticReview: { status: 'failed', message: 'off topic' },
    }).outcome,
    'failed',
  );
  assert.equal(
    verifyMemoryContract({
      before,
      after: state({
        'profile.md':
          profile('communication.review-format', 'Key risks only') +
          profile('coding.language', 'TypeScript'),
      }),
      contract: { kind: 'profile-update', key: 'communication.review-format' },
      semanticReview: { status: 'inconclusive' },
    }).outcome,
    'inconclusive',
  );
  assert.equal(
    verifyMemoryContract({
      before,
      after: state({
        'profile.md':
          profile('communication.review-format', 'Conclusion first') +
          profile('coding.language', 'TypeScript') +
          profile('new.key', 'Added'),
      }),
      contract: { kind: 'profile-create', key: 'new.key', deterministic: true },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before,
      after: state({ 'profile.md': profile('coding.language', 'TypeScript') }),
      contract: { kind: 'profile-forget', key: 'communication.review-format' },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before,
      after: state({
        'profile.md':
          profile('communication.review-format', 'Conclusion first') +
          profile('coding.language', 'TypeScript') +
          '\n<!-- paused -->\n',
      }),
      contract: { kind: 'profile-control' },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before,
      after: before,
      contract: { kind: 'profile-control' },
    }).outcome,
    'failed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state(),
      after: state({}, { '/inputs/a.md': doc('memory-kind: input\nstatus: active') }),
      contract: { kind: 'project-input-create', deterministic: true },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state({}, { '/inputs/a.md': doc('memory-kind: input\nstatus: active') }),
      after: state({}, { '/inputs/a.md': doc('memory-kind: input\nstatus: active') }),
      contract: { kind: 'project-input-idempotent' },
    }).outcome,
    'passed',
  );
  const seeded = state({}, { '/inputs/a.md': doc('memory-kind: input\nstatus: active') });
  assert.equal(
    verifyMemoryContract({
      before: seeded,
      after: seeded,
      contract: { kind: 'typed-report', operation: 'maintain', trigger: 'active-input' },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state({}, { 'README.md': 'hi' }),
      after: state({}, { 'README.md': 'hi' }),
      contract: { kind: 'typed-report', operation: 'repair', trigger: 'missing-readme' },
    }).outcome,
    'failed',
  );
  const curation = state(
    {},
    { '/inputs/a.md': doc('memory-kind: input\nretention: workstream\nstatus: active') },
  );
  assert.equal(
    verifyMemoryContract({
      before: curation,
      after: curation,
      contract: { kind: 'typed-report', operation: 'curate', trigger: 'curation-candidate' },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state(),
      after: state(),
      contract: { kind: 'typed-operation' },
    }).outcome,
    'inconclusive',
  );
  assert.equal(
    verifyMemoryContract({
      before: state(),
      after: state({}, { '/inputs/a.md': doc('memory-kind: input\nstatus: active') }),
      contract: { kind: 'typed-operation', operation: 'capture-input', deterministic: true },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state({}, { '/inputs/a.md': doc('memory-kind: input\nstatus: active') }),
      after: state({}, { '/inputs/a.md': doc('memory-kind: input\nstatus: complete') }),
      contract: { kind: 'typed-operation', operation: 'close-input', deterministic: true },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state({}, { '/facts/a.md': doc('status: complete') }),
      after: state({}, { '/_archive/2026/09/facts/a.md': doc('status: archived') }),
      contract: { kind: 'typed-operation', operation: 'archive', deterministic: true },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state(
        {},
        { '/facts/old.md': doc('status: active'), '/facts/new.md': doc('status: active') },
      ),
      after: state(
        {},
        {
          '/facts/old.md': doc('status: superseded\nsuperseded-by: memory:facts/new.md'),
          '/facts/new.md': doc('status: active'),
        },
      ),
      contract: { kind: 'typed-operation', operation: 'supersede', deterministic: true },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state(),
      after: state({}, { '/sessions/a.md': doc('type: session-handoff\nstatus: active') }),
      contract: { kind: 'typed-operation', operation: 'handoff', deterministic: true },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state({}, { '/sessions/a.md': doc('type: session-handoff\nstatus: active') }),
      after: state({}, { '/sessions/a.md': doc('type: session-handoff\nstatus: complete') }),
      contract: { kind: 'typed-operation', operation: 'close-handoff', deterministic: true },
    }).outcome,
    'passed',
  );
  const migrateBefore = state(
    {},
    {
      '/inputs/a.md': doc('memory-kind: input\nstatus: active\ndescription: old'),
      '/inputs/b.md': doc('memory-kind: input\nstatus: active\ndescription: keep'),
    },
  );
  const migrateAfter = state(
    {},
    {
      '/inputs/a.md': doc('memory-kind: input\nstatus: active\ndescription: Migrated eval fixture'),
      '/inputs/b.md': doc('memory-kind: input\nstatus: active\ndescription: keep'),
    },
  );
  assert.equal(
    verifyMemoryContract({
      before: migrateBefore,
      after: migrateAfter,
      contract: { kind: 'typed-operation', operation: 'migrate', deterministic: true },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before: migrateBefore,
      after: migrateBefore,
      contract: { kind: 'typed-operation', operation: 'migrate', deterministic: true },
    }).outcome,
    'failed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state({}, { '/inputs/a.md': doc('memory-kind: input\nstatus: active') }),
      after: state({}, { '/inputs/a.md': doc('memory-kind: input\nstatus: complete') }),
      contract: { kind: 'typed-operation', operation: 'curation-apply', deterministic: true },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state(),
      after: state(
        {},
        {
          '/findings/a.md':
            '---\ntype: analytical-finding\nmemory-kind: working\nfinding-digest: sha256:x\nsource-refs: [chat]\n---\n',
        },
      ),
      contract: { kind: 'typed-operation', operation: 'capture-finding', deterministic: true },
    }).outcome,
    'passed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state(),
      after: state({}, { '/x.md': '---\nstatus: active\n---\n' }),
      contract: { kind: 'typed-operation', operation: 'capture-experience', deterministic: true },
    }).outcome,
    'failed',
  );
  assert.equal(
    verifyMemoryContract({
      before: state({ 'profile.md': '- not a profile line\n' }),
      after: state({ 'profile.md': '- not a profile line\n' }),
      contract: { kind: 'profile-update', key: 'x' },
    }).outcome,
    'failed',
  );
}

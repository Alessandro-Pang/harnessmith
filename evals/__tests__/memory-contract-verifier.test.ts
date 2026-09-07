import { describe, expect, it } from 'vitest';
import {
  type MemoryContractState,
  verifyMemoryContract,
} from '../../scripts/evaluation/memory/memory-contract-verifier.js';

const profile = (key: string, conclusion: string) =>
  `- ${key} | ${conclusion} | explicit | high | 2026-09-07\n`;
const state = (
  global: Record<string, string> = {},
  project: Record<string, string> = {},
): MemoryContractState => ({ global, project });
const before = state({
  'profile.md':
    profile('communication.review-format', 'Conclusion first') +
    profile('coding.language', 'TypeScript'),
});
const input = {
  before,
  after: before,
  contract: { kind: 'profile-update' as const, key: 'communication.review-format' },
  semanticReview: { status: 'passed' as const },
};

describe('independent Memory contract', () => {
  it('rejects a valid but unrelated profile update', () => {
    const after = state({
      'profile.md':
        profile('communication.review-format', 'Conclusion first') +
        profile('coding.language', 'Python'),
    });
    expect(verifyMemoryContract({ ...input, after }).outcome).toBe('failed');
  });
  it('rejects profile updates that also mutate project memory', () => {
    const after = state(
      {
        'profile.md':
          profile('communication.review-format', 'Key risks only') +
          profile('coding.language', 'TypeScript'),
      },
      { 'input.md': 'extra project fact' },
    );
    expect(verifyMemoryContract({ ...input, after }).outcome).toBe('failed');
  });
  it('requires independent semantic review of free-form persisted conclusions', () => {
    const after = state({
      'profile.md':
        profile('communication.review-format', 'Unrelated arbitrary text') +
        profile('coding.language', 'TypeScript'),
    });
    expect(verifyMemoryContract({ ...input, after, semanticReview: undefined }).outcome).toBe(
      'inconclusive',
    );
  });
  it('verifies exact-key forget without dropping unrelated keys', () => {
    const contract = { kind: 'profile-forget' as const, key: 'communication.review-format' };
    expect(
      verifyMemoryContract({ before, after: state({ 'profile.md': '' }), contract }).outcome,
    ).toBe('failed');
    expect(
      verifyMemoryContract({
        before,
        after: state({ 'profile.md': profile('coding.language', 'TypeScript') }),
        contract,
      }).outcome,
    ).toBe('passed');
  });
  it('rejects malformed profile lines and duplicate keys', () => {
    const after = state({
      'profile.md':
        profile('communication.review-format', 'Key risks') +
        profile('communication.review-format', 'Different risks'),
    });
    expect(verifyMemoryContract({ ...input, after }).outcome).toBe('failed');
  });
  it('checks no-write across both scopes', () => {
    expect(
      verifyMemoryContract({
        before: state(),
        after: state({}, { 'input.md': 'wrong scope' }),
        contract: { kind: 'no-write' },
      }).outcome,
    ).toBe('failed');
  });
  it('does not accept a missing contract', () => {
    expect(verifyMemoryContract({ before: state(), after: state() }).outcome).toBe('inconclusive');
  });
});

describe('operation-specific lifecycle relations', () => {
  const doc = (meta: string) => `---\n${meta}\n---\nbody\n`;
  it('requires close-input status transition', async () => {
    const { verifyMemoryContract } = await import(
      '../../scripts/evaluation/memory/memory-contract-verifier.js'
    );
    const before = state({}, { '/inputs/a.md': doc('memory-kind: input\nstatus: active') });
    const after = state({}, { '/inputs/a.md': doc('memory-kind: input\nstatus: complete') });
    expect(
      verifyMemoryContract({
        before,
        after,
        contract: { kind: 'typed-operation', operation: 'close-input' },
        semanticReview: { status: 'passed' },
      }).outcome,
    ).toBe('passed');
  });
  it('requires archive move and archived metadata', async () => {
    const { verifyMemoryContract } = await import(
      '../../scripts/evaluation/memory/memory-contract-verifier.js'
    );
    const before = state({}, { '/facts/a.md': doc('status: complete') });
    const after = state({}, { '/_archive/2026/09/facts/a.md': doc('status: archived') });
    expect(
      verifyMemoryContract({
        before,
        after,
        contract: { kind: 'typed-operation', operation: 'archive' },
        semanticReview: { status: 'passed' },
      }).outcome,
    ).toBe('passed');
  });
  it('requires supersede target relationship', async () => {
    const { verifyMemoryContract } = await import(
      '../../scripts/evaluation/memory/memory-contract-verifier.js'
    );
    const before = state(
      {},
      { '/facts/old.md': doc('status: active'), '/facts/new.md': doc('status: active') },
    );
    const after = state(
      {},
      {
        '/facts/old.md': doc('status: superseded\nsuperseded-by: memory:facts/new.md'),
        '/facts/new.md': doc('status: active'),
      },
    );
    expect(
      verifyMemoryContract({
        before,
        after,
        contract: { kind: 'typed-operation', operation: 'supersede' },
        semanticReview: { status: 'passed' },
      }).outcome,
    ).toBe('passed');
  });
  it('requires handoff active to complete transition', async () => {
    const { verifyMemoryContract } = await import(
      '../../scripts/evaluation/memory/memory-contract-verifier.js'
    );
    const before = state({}, { '/sessions/a.md': doc('type: session-handoff\nstatus: active') });
    const after = state({}, { '/sessions/a.md': doc('type: session-handoff\nstatus: complete') });
    expect(
      verifyMemoryContract({
        before,
        after,
        contract: { kind: 'typed-operation', operation: 'close-handoff' },
        semanticReview: { status: 'passed' },
      }).outcome,
    ).toBe('passed');
  });
});

it('requires finding and experience document types and provenance metadata', async () => {
  const { verifyMemoryContract } = await import(
    '../../scripts/evaluation/memory/memory-contract-verifier.js'
  );
  const before = state();
  const finding = state(
    {},
    {
      '/findings/a.md':
        '---\ntype: analytical-finding\nmemory-kind: working\nfinding-digest: sha256:x\nsource-refs: [chat]\n---\n',
    },
  );
  expect(
    verifyMemoryContract({
      before,
      after: finding,
      contract: { kind: 'typed-operation', operation: 'capture-finding' },
      semanticReview: { status: 'passed' },
    }).outcome,
  ).toBe('passed');
  const arbitrary = state({}, { '/x.md': '---\nstatus: active\n---\n' });
  expect(
    verifyMemoryContract({
      before,
      after: arbitrary,
      contract: { kind: 'typed-operation', operation: 'capture-experience' },
      semanticReview: { status: 'passed' },
    }).outcome,
  ).toBe('failed');
});

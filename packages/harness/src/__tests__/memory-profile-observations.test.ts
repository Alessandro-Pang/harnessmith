import { expect, test } from 'vitest';
import { aggregateProfileObservations } from '../lib/memory/memory-profile-observations.js';

test('promotes repeated matching observations into a proposed profile candidate', () => {
  const result = aggregateProfileObservations([
    {
      key: 'engineering.review-standard',
      conclusion: '评审必须给出证据和最小修复方向',
      sourceRef: 'session:one',
    },
    {
      key: 'engineering.review-standard',
      conclusion: '评审必须给出证据和最小修复方向',
      sourceRef: 'session:two',
    },
  ]);

  expect(result).toEqual({
    status: 'proposed',
    key: 'engineering.review-standard',
    conclusion: '评审必须给出证据和最小修复方向',
    evidence: 'observed',
    confidence: 'medium',
    sourceRefs: ['session:one', 'session:two'],
  });
});

test('does not promote a single observation or conflicting conclusions', () => {
  expect(
    aggregateProfileObservations([
      { key: 'communication.detail', conclusion: '回答简洁', sourceRef: 'session:one' },
    ]).status,
  ).toBe('candidate');
  expect(
    aggregateProfileObservations([
      { key: 'communication.detail', conclusion: '回答简洁', sourceRef: 'session:one' },
      { key: 'communication.detail', conclusion: '回答详细', sourceRef: 'session:two' },
    ]).status,
  ).toBe('conflict');
});

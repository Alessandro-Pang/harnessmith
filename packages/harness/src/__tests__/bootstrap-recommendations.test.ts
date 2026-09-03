import assert from 'node:assert/strict';
import { test } from 'vitest';
import {
  type BootstrapMemoryRead,
  type BootstrapMetadata,
  recommendedBootstrapReads,
} from '../lib/bootstrap/bootstrap-memory.js';
import type { MemoryCoreBudgetReport } from '../lib/memory/memory-core-budget.js';
import type { MemoryMaintenanceReport } from '../lib/memory/memory-maintenance.js';

function metadata(path: string, status: string, requiresReverification = false): BootstrapMetadata {
  return {
    path: `${path}.md`,
    type: 'working-note',
    kind: 'working',
    status,
    updated: '2026-09-01',
    title: path,
    factClass: requiresReverification ? ('current-state' as const) : null,
    classification: requiresReverification ? 'explicit' : 'legacy-unclassified',
    requiresReverification,
  };
}

test('bootstrap recommendations rank recovery context and explain duplicate evidence', () => {
  const memory: BootstrapMemoryRead = {
    state: 'valid',
    metadata: [
      metadata('blocked', 'blocked', true),
      metadata('active', 'active'),
      metadata('workstream', 'active'),
      metadata('unindexed', 'active'),
      metadata('expired', 'active', true),
      metadata('closed', 'complete'),
    ],
    core: {
      budget: {} as MemoryCoreBudgetReport,
      references: ['memory:active', 'memory:blocked'],
    },
    maintenance: {
      workstreamInputs: ['workstream.md'],
      unindexed: ['unindexed.md', 'blocked.md'],
      genericActionInputs: [],
      legacyInputs: [],
      expiredWorking: ['expired.md'],
      closed: ['closed.md'],
    } as unknown as MemoryMaintenanceReport,
    discoveredMetadata: 6,
  };

  const report = recommendedBootstrapReads('/tmp/.agent-docs', memory, [], 8);

  assert.deepEqual(
    report.recommendations.map(({ reference }) => reference),
    [
      'memory:blocked',
      'memory:active',
      'memory:workstream',
      'memory:unindexed',
      'memory:expired',
      'memory:closed',
    ],
  );
  assert.deepEqual(report.recommendations[0], {
    reference: 'memory:blocked',
    reasonCodes: ['core-blocked', 'maintenance-unindexed'],
    sources: ['core', 'maintenance'],
    status: 'blocked',
    requiresReverification: true,
  });
});

test('bootstrap recommendation limits report omitted candidates without changing ranking', () => {
  const memory: BootstrapMemoryRead = {
    state: 'valid',
    metadata: Array.from({ length: 10 }, (_, index) => metadata(`active-${index}`, 'active')),
    core: {
      budget: {} as MemoryCoreBudgetReport,
      references: Array.from({ length: 10 }, (_, index) => `memory:active-${9 - index}`),
    },
    maintenance: null,
    discoveredMetadata: 10,
  };
  const reasons: string[] = [];

  const report = recommendedBootstrapReads('/tmp/.agent-docs', memory, reasons, 8);

  assert.equal(report.discovered, 10);
  assert.equal(report.recommendations.length, 8);
  assert.deepEqual(
    report.recommendations.map(({ reference }) => reference),
    Array.from({ length: 8 }, (_, index) => `memory:active-${index}`),
  );
  assert.ok(reasons.some((reason) => /10 discovered, 8 returned/i.test(reason)));
});

import { join } from 'node:path';
import type { MemoryMaintenanceReport } from '../memory/memory-maintenance.js';
import { memoryReference } from '../memory/memory-path.js';
import type { BootstrapMemoryRead } from './bootstrap-memory.js';

export const bootstrapRecommendationLimit = 32;
export const bootstrapBriefRecommendationLimit = 8;

type BootstrapRecommendationReason =
  | 'core-blocked'
  | 'core-active'
  | 'maintenance-workstream-input'
  | 'maintenance-unindexed'
  | 'maintenance-generic-action-input'
  | 'maintenance-legacy-input'
  | 'maintenance-expired-working'
  | 'maintenance-closed';

export interface BootstrapRecommendation {
  reference: string;
  reasonCodes: BootstrapRecommendationReason[];
  sources: Array<'core' | 'maintenance'>;
  status: string | null;
  requiresReverification: boolean;
}

interface BootstrapRecommendationRead {
  recommendations: BootstrapRecommendation[];
  discovered: number;
}

interface RankedRecommendation extends BootstrapRecommendation {
  priority: number;
}

function maintenanceRecommendationGroups(maintenance: MemoryMaintenanceReport | null) {
  if (!maintenance) return [];
  return [
    { paths: maintenance.workstreamInputs, reason: 'maintenance-workstream-input', priority: 70 },
    { paths: maintenance.unindexed, reason: 'maintenance-unindexed', priority: 60 },
    {
      paths: maintenance.genericActionInputs,
      reason: 'maintenance-generic-action-input',
      priority: 50,
    },
    { paths: maintenance.legacyInputs, reason: 'maintenance-legacy-input', priority: 40 },
    { paths: maintenance.expiredWorking, reason: 'maintenance-expired-working', priority: 20 },
    { paths: maintenance.closed, reason: 'maintenance-closed', priority: 10 },
  ] as const;
}

export function recommendedBootstrapReads(
  memoryRoot: string,
  memory: BootstrapMemoryRead,
  reasons: string[],
  limit = bootstrapRecommendationLimit,
): BootstrapRecommendationRead {
  const metadataByReference = new Map(
    memory.metadata.map((document) => [
      `memory:${memoryReference(memoryRoot, join(memoryRoot, document.path))}`,
      document,
    ]),
  );
  const byReference = new Map<string, RankedRecommendation>();
  const add = (
    reference: string,
    reason: BootstrapRecommendationReason,
    priority: number,
    source: 'core' | 'maintenance',
  ) => {
    const metadata = metadataByReference.get(reference);
    const existing = byReference.get(reference) ?? {
      reference,
      reasonCodes: [],
      sources: [],
      status: metadata?.status ?? null,
      requiresReverification: metadata?.requiresReverification ?? false,
      priority,
    };
    if (!existing.reasonCodes.includes(reason)) existing.reasonCodes.push(reason);
    if (!existing.sources.includes(source)) existing.sources.push(source);
    existing.priority = Math.max(existing.priority, priority);
    byReference.set(reference, existing);
  };
  for (const reference of memory.core?.references ?? []) {
    const status = metadataByReference.get(reference)?.status;
    if (status === 'blocked') add(reference, 'core-blocked', 100, 'core');
    if (status === 'active') add(reference, 'core-active', 90, 'core');
  }
  for (const group of maintenanceRecommendationGroups(memory.maintenance)) {
    for (const path of group.paths) {
      add(`memory:${path.replace(/\.md$/, '')}`, group.reason, group.priority, 'maintenance');
    }
  }
  const ranked = [...byReference.values()].sort(
    (left, right) =>
      right.priority - left.priority || left.reference.localeCompare(right.reference),
  );
  if (ranked.length > limit) {
    reasons.push(`Recommended reads truncated: ${ranked.length} discovered, ${limit} returned`);
  }
  return {
    recommendations: ranked.slice(0, limit).map(({ priority: _, ...item }) => item),
    discovered: ranked.length,
  };
}

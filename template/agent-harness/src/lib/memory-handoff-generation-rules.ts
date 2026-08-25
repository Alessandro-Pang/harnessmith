import type { Io } from '../types.js';
import { handoffIdentityFromMetadata } from './memory-handoff-identity.js';

interface HandoffGenerationRecord {
  generation: number;
  path: string;
  sessionBase: string;
  status: string;
}

export type HandoffGenerationState = Map<string, HandoffGenerationRecord[]>;

export function recordTypedHandoffGeneration(
  metadata: Map<string, unknown>,
  path: string,
  state: HandoffGenerationState,
): void {
  if (
    metadata.get('type') !== 'session-handoff' ||
    metadata.get('memory-kind') !== 'episode' ||
    metadata.get('snapshot-mode') !== 'replace'
  ) {
    return;
  }
  try {
    const identity = handoffIdentityFromMetadata(metadata);
    const key = identity.sessionBase.normalize('NFC').toLowerCase();
    const generations = state.get(key) || [];
    generations.push({
      generation: identity.generation,
      path,
      sessionBase: identity.sessionBase,
      status: String(metadata.get('status') || 'unknown'),
    });
    state.set(key, generations);
  } catch {
    // validateTypedHandoff reports the document-local identity failure.
  }
}

export function validateHandoffGenerations(state: HandoffGenerationState, io: Io): number {
  let failures = 0;
  for (const generations of state.values()) {
    const bases = new Set(generations.map((entry) => entry.sessionBase));
    if (bases.size > 1) {
      io.error(
        `Portable handoff base identity collision: ${generations.map((entry) => entry.path).join(', ')}`,
      );
      failures += 1;
    }
    const byGeneration = new Map<number, string>();
    for (const entry of generations) {
      const existing = byGeneration.get(entry.generation);
      if (existing) {
        io.error(`Duplicate handoff generation ${entry.generation}: ${existing} and ${entry.path}`);
        failures += 1;
      } else byGeneration.set(entry.generation, entry.path);
    }
    const active = generations.filter((entry) => ['active', 'blocked'].includes(entry.status));
    if (active.length > 1) {
      io.error(
        `Multiple active handoff generations for ${generations[0]?.sessionBase}: ${active.map((entry) => entry.path).join(', ')}`,
      );
      failures += 1;
    }
    const latestGeneration = Math.max(...generations.map((entry) => entry.generation));
    if (active[0] && active[0].generation !== latestGeneration) {
      io.error(
        `An older handoff generation remains active for ${active[0].sessionBase}: ${active[0].path}`,
      );
      failures += 1;
    }
  }
  return failures;
}

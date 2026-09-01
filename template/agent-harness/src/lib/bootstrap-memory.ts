import { join, relative } from 'node:path';
import { calendarDate } from '../runtime.js';
import type { Io, ProjectSnapshot, Runtime } from '../types.js';
import { parseFrontmatterDocument } from './frontmatter.js';
import { type MemoryCoreBudgetReport, memoryCoreBudget } from './memory-core-budget.js';
import {
  classifyMemoryFact,
  type MemoryFactClass,
  type MemoryFactClassification,
} from './memory-fact-semantics.js';
import { type MemoryMaintenanceReport, memoryMaintenanceReport } from './memory-maintenance.js';
import { markdownFiles, readMemoryDocument } from './memory-path.js';
import { validateMemoryRoot } from './memory-validation.js';

export {
  type BootstrapRecommendation,
  bootstrapBriefRecommendationLimit,
  bootstrapRecommendationLimit,
  recommendedBootstrapReads,
} from './bootstrap-recommendations.js';

export const bootstrapMetadataLimit = 64;

export type BootstrapState = 'uninitialized' | 'partial' | 'valid' | 'invalid' | 'inconclusive';

export interface BootstrapMetadata {
  path: string;
  type: string;
  kind: string;
  status: string;
  updated: string;
  title: string;
  factClass: MemoryFactClass | null;
  classification: MemoryFactClassification;
  requiresReverification: boolean;
}

export interface BootstrapMemoryRead {
  state: BootstrapState;
  metadata: BootstrapMetadata[];
  core: { budget: MemoryCoreBudgetReport; references: string[] } | null;
  maintenance: MemoryMaintenanceReport | null;
  discoveredMetadata: number;
}

function diagnosticIo(errors: string[]): Io {
  return {
    log: () => undefined,
    error: (message: unknown = '') => errors.push(String(message)),
  };
}

function stateForFailure(messages: string[]): 'invalid' | 'inconclusive' {
  return messages.some((message) => /budget|timeout|deadline|unavailable/i.test(message))
    ? 'inconclusive'
    : 'invalid';
}

function coreReferences(content: string): string[] {
  return [
    ...new Set(
      [...content.matchAll(/memory:([A-Za-z0-9_./-]+)/g)].map((match) => `memory:${match[1]}`),
    ),
  ];
}

function validateBootstrapMemory(memoryRoot: string, reasons: string[]): BootstrapState {
  const validationErrors: string[] = [];
  try {
    validateMemoryRoot(memoryRoot, diagnosticIo(validationErrors), {
      quietSuccess: false,
      rootKind: 'project',
    });
    return 'valid';
  } catch (error) {
    const messages = [...validationErrors, error instanceof Error ? error.message : String(error)];
    const state = stateForFailure(messages);
    reasons.push(`Memory ${state}: ${messages.join('; ')}`);
    return state;
  }
}

function readBootstrapCore(memoryRoot: string, reasons: string[]) {
  try {
    const content = readMemoryDocument(join(memoryRoot, 'core.md'));
    return {
      core: { budget: memoryCoreBudget(content), references: coreReferences(content) },
      failure: undefined,
    };
  } catch (error) {
    reasons.push(`Core skipped: ${String(error)}`);
    return { core: null, failure: stateForFailure([String(error)]) };
  }
}

function readBootstrapMetadata(memoryRoot: string, reasons: string[]) {
  try {
    const files = markdownFiles(memoryRoot, { archive: false });
    const metadata = files.slice(0, bootstrapMetadataLimit).map((path) => {
      const parsed = parseFrontmatterDocument(readMemoryDocument(path));
      const semantics = classifyMemoryFact(parsed.metadata);
      return {
        path: relative(memoryRoot, path).replaceAll('\\', '/'),
        type: String(parsed.metadata.get('type') || 'unknown'),
        kind: String(parsed.metadata.get('memory-kind') || 'unknown'),
        status: String(parsed.metadata.get('status') || 'unknown'),
        updated: String(parsed.metadata.get('updated') || 'unknown'),
        title: String(parsed.metadata.get('title') || 'untitled'),
        ...semantics,
      };
    });
    if (files.length > bootstrapMetadataLimit) {
      reasons.push(
        `Memory metadata truncated: ${files.length} discovered, ${bootstrapMetadataLimit} returned`,
      );
    }
    return { metadata, discovered: files.length, failure: undefined };
  } catch (error) {
    reasons.push(`Memory metadata skipped: ${String(error)}`);
    return { metadata: [], discovered: 0, failure: stateForFailure([String(error)]) };
  }
}

export function readBootstrapMemory(
  runtime: Runtime,
  snapshot: ProjectSnapshot,
  reasons: string[],
): BootstrapMemoryRead {
  if (!snapshot.memory.initialized) {
    const state = snapshot.memory.exists ? 'partial' : 'uninitialized';
    reasons.push(
      `Memory bootstrap skipped: project Memory is ${state === 'partial' ? 'only partially initialized' : 'not initialized'}`,
    );
    return { state, metadata: [], core: null, maintenance: null, discoveredMetadata: 0 };
  }
  const memoryRoot = snapshot.memory.root;
  let state = validateBootstrapMemory(memoryRoot, reasons);
  const coreResult = readBootstrapCore(memoryRoot, reasons);
  if (coreResult.failure) state = coreResult.failure;
  const metadataResult = readBootstrapMetadata(memoryRoot, reasons);
  if (metadataResult.failure) state = metadataResult.failure;
  let maintenance: MemoryMaintenanceReport | null = null;
  try {
    maintenance = memoryMaintenanceReport(memoryRoot, calendarDate(runtime));
  } catch (error) {
    reasons.push(`Memory maintenance skipped: ${String(error)}`);
    if (state === 'valid') state = stateForFailure([String(error)]);
  }
  return {
    state,
    metadata: metadataResult.metadata,
    core: coreResult.core,
    maintenance,
    discoveredMetadata: metadataResult.discovered,
  };
}

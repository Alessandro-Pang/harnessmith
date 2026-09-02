import { parseFrontmatterDocument } from '../documentation/frontmatter.js';

const memoryFactClasses = [
  'settled-fact',
  'current-state',
  'verification-pointer',
  'recovery-state',
  'formal-fact',
] as const;

export type MemoryFactClass = (typeof memoryFactClasses)[number];
export type MemoryFactClassification = 'explicit' | 'derived' | 'legacy-unclassified';

export interface MemoryFactSemantics {
  factClass: MemoryFactClass | null;
  classification: MemoryFactClassification;
  requiresReverification: boolean;
}

export function isMemoryFactClass(value: unknown): value is MemoryFactClass {
  return memoryFactClasses.includes(value as MemoryFactClass);
}

export function assertFindingFactSemantics(
  retention: 'workstream' | 'durable',
  factClass: MemoryFactClass,
): void {
  if (!isMemoryFactClass(factClass)) {
    throw new Error(`Invalid finding fact class: ${String(factClass)}`);
  }
  if (factClass === 'formal-fact') {
    throw new Error('Analytical findings cannot declare formal-fact authority');
  }
  if (retention === 'durable' && ['current-state', 'recovery-state'].includes(factClass)) {
    throw new Error(`${factClass} cannot use durable finding retention`);
  }
}

export function validFactExpiry(value: string | undefined): value is string {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function classifyMemoryFact(metadata: Map<string, unknown>): MemoryFactSemantics {
  const explicit = metadata.get('fact-class');
  if (isMemoryFactClass(explicit)) {
    return {
      factClass: explicit,
      classification: 'explicit',
      requiresReverification: explicit === 'current-state' || explicit === 'recovery-state',
    };
  }
  if (metadata.get('type') === 'session-handoff') {
    return {
      factClass: 'recovery-state',
      classification: 'derived',
      requiresReverification: true,
    };
  }
  if (metadata.get('source-of-truth') === true) {
    return {
      factClass: 'formal-fact',
      classification: 'derived',
      requiresReverification: false,
    };
  }
  return {
    factClass: null,
    classification: 'legacy-unclassified',
    requiresReverification: false,
  };
}

export function classifyMemoryDocument(content: string): MemoryFactSemantics {
  try {
    return classifyMemoryFact(parseFrontmatterDocument(content).metadata);
  } catch {
    return {
      factClass: null,
      classification: 'legacy-unclassified',
      requiresReverification: false,
    };
  }
}

import { parseInputBody } from './memory-input.js';

export interface MaintenanceParsedDocument {
  name: string;
  metadata: Map<string, unknown>;
  references: string[];
  body: string;
}

const genericActions = new Set([
  '提交',
  '发布',
  '继续',
  '推送',
  '合并',
  'commit',
  'publish',
  'continue',
  'push',
  'merge',
]);

function referenceIdentity(value: string): string {
  return value
    .replace(/^memory:/, '')
    .replace(/\.md$/, '')
    .toLowerCase();
}

function duplicateActiveTitles(documents: MaintenanceParsedDocument[]) {
  const titles = new Map<string, string[]>();
  for (const { name, metadata } of documents) {
    if (!['active', 'blocked'].includes(String(metadata.get('status') || ''))) continue;
    const title = String(metadata.get('title') || '').trim();
    if (title) titles.set(title, [...(titles.get(title) || []), name]);
  }
  return [...titles]
    .filter(([, paths]) => paths.length > 1)
    .map(([title, paths]) => ({ title, paths: paths.sort() }))
    .sort((left, right) => left.title.localeCompare(right.title));
}

function supersessionCycles(documents: MaintenanceParsedDocument[]): string[][] {
  const next = new Map<string, string>();
  const names = new Map<string, string>();
  for (const { name, metadata } of documents) {
    const reference = referenceIdentity(name);
    names.set(reference, name);
    const value = metadata.get('superseded-by');
    if (typeof value === 'string' && value.startsWith('memory:')) {
      next.set(reference, referenceIdentity(value));
    }
  }
  const keys = new Set<string>();
  const cycles: string[][] = [];
  for (const start of [...next.keys()].sort()) {
    const order: string[] = [];
    const seen = new Map<string, number>();
    let current: string | undefined = start;
    while (current && next.has(current)) {
      const index = seen.get(current);
      if (index !== undefined) {
        const nodes = order.slice(index);
        const first = nodes.reduce((best, value, item) => (value < nodes[best] ? item : best), 0);
        const rotated = [...nodes.slice(first), ...nodes.slice(0, first)];
        const cycle = [...rotated, rotated[0]];
        const key = cycle.join('\0');
        if (!keys.has(key)) {
          keys.add(key);
          cycles.push(cycle.map((reference) => names.get(reference) || reference));
        }
        break;
      }
      seen.set(current, order.length);
      order.push(current);
      current = next.get(current);
    }
  }
  return cycles;
}

function inputDiagnostics(documents: MaintenanceParsedDocument[]) {
  const result = {
    activeInputCount: 0,
    legacyInputs: [] as string[],
    genericActionInputs: [] as string[],
    workstreamInputs: [] as string[],
  };
  for (const { name, metadata, body } of documents) {
    if (
      !['active', 'blocked'].includes(String(metadata.get('status') || '')) ||
      metadata.get('memory-kind') !== 'input'
    ) {
      continue;
    }
    result.activeInputCount += 1;
    if (metadata.get('input-schema-version') !== 2) result.legacyInputs.push(name);
    if (metadata.get('retention') === 'workstream') result.workstreamInputs.push(name);
    const parsed = parseInputBody(body);
    if (parsed && genericActions.has(parsed.content.trim().normalize('NFKC').toLowerCase())) {
      result.genericActionInputs.push(name);
    }
  }
  return result;
}

export function analyzeMaintenanceDocuments(documents: MaintenanceParsedDocument[]) {
  const inputs = inputDiagnostics(documents);
  return {
    duplicateTitles: duplicateActiveTitles(documents),
    supersessionCycles: supersessionCycles(documents),
    activeInputCount: inputs.activeInputCount,
    legacyInputs: inputs.legacyInputs.sort(),
    genericActionInputs: inputs.genericActionInputs.sort(),
    workstreamInputs: inputs.workstreamInputs.sort(),
  };
}

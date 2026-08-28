import { relative } from 'node:path';
import { parseFrontmatterDocument } from './frontmatter.js';
import { parseInputBody } from './memory-input.js';
import { markdownFiles, readMemoryDocument } from './memory-path.js';
import {
  contentMemoryReferences,
  isOpaqueMemoryContent,
  metadataReferences,
} from './memory-validation.js';

export interface MemoryMaintenanceReport {
  version: 1;
  root: string;
  totalFiles: number;
  unindexed: string[];
  expiredWorking: string[];
  closed: string[];
  duplicateTitles: Array<{ title: string; paths: string[] }>;
  supersessionCycles: string[][];
  activeInputCount: number;
  legacyInputs: string[];
  genericActionInputs: string[];
  workstreamInputs: string[];
}

interface MemoryDocument {
  name: string;
  metadata: Map<string, unknown>;
  references: string[];
  body: string;
}

interface InputDiagnostics {
  activeInputCount: number;
  legacyInputs: string[];
  genericActionInputs: string[];
  workstreamInputs: string[];
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

function portablePath(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}

function referenceIdentity(value: string): string {
  return value
    .replace(/^memory:/, '')
    .replace(/\.md$/, '')
    .toLowerCase();
}

function supersededBy(metadata: Map<string, unknown>): string | null {
  const value = metadata.get('superseded-by');
  return typeof value === 'string' && value.startsWith('memory:') ? referenceIdentity(value) : null;
}

function normalizedCycle(nodes: string[]): string[] {
  const start = nodes.reduce((best, value, index) => (value < nodes[best] ? index : best), 0);
  const rotated = [...nodes.slice(start), ...nodes.slice(0, start)];
  return [...rotated, rotated[0]];
}

function duplicateActiveTitles(documents: MemoryDocument[]) {
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

function findSupersessionCycles(documents: MemoryDocument[]): string[][] {
  const next = new Map<string, string>();
  const names = new Map<string, string>();
  for (const { name, metadata } of documents) {
    const reference = referenceIdentity(name);
    names.set(reference, name);
    const target = supersededBy(metadata);
    if (target) next.set(reference, target);
  }
  const cycleKeys = new Set<string>();
  const cycles: string[][] = [];
  for (const start of [...next.keys()].sort()) {
    const order: string[] = [];
    const seen = new Map<string, number>();
    let current: string | undefined = start;
    while (current && next.has(current)) {
      const index = seen.get(current);
      if (index !== undefined) {
        const cycle = normalizedCycle(order.slice(index));
        const key = cycle.join('\0');
        if (!cycleKeys.has(key)) {
          cycleKeys.add(key);
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

function inputDiagnostics(documents: MemoryDocument[]): InputDiagnostics {
  const result: InputDiagnostics = {
    activeInputCount: 0,
    legacyInputs: [],
    genericActionInputs: [],
    workstreamInputs: [],
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

export function memoryMaintenanceReport(root: string, today: string): MemoryMaintenanceReport {
  const files = markdownFiles(root, { archive: false });
  const documents = files.map((path) => {
    const content = readMemoryDocument(path);
    const parsed = parseFrontmatterDocument(content);
    const metadata = parsed.metadata;
    const bodyReferences = isOpaqueMemoryContent(metadata, { root, path })
      ? []
      : contentMemoryReferences(content);
    const references = [...bodyReferences, ...metadataReferences(metadata)].map((reference) =>
      referenceIdentity(reference),
    );
    return { name: portablePath(root, path), metadata, references, body: parsed.body };
  });
  const byReference = new Map(
    documents.map((document) => [referenceIdentity(document.name), document]),
  );
  const reachable = new Set<string>();
  const pending = byReference.has('core') ? ['core'] : [];
  while (pending.length > 0) {
    const reference = pending.pop();
    if (!reference || reachable.has(reference)) continue;
    reachable.add(reference);
    const document = byReference.get(reference);
    if (!document) continue;
    for (const child of document.references) {
      if (byReference.has(child) && !reachable.has(child)) pending.push(child);
    }
  }

  const active = new Set(['active', 'blocked']);
  const closedStatuses = new Set(['complete', 'superseded']);
  const unindexed: string[] = [];
  const expiredWorking: string[] = [];
  const closed: string[] = [];
  for (const { name, metadata } of documents) {
    if (name === 'README.md' || name === 'core.md') continue;
    const status = String(metadata.get('status') || '');
    const reference = referenceIdentity(name);
    if (active.has(status) && !reachable.has(reference)) unindexed.push(name);
    if (
      active.has(status) &&
      metadata.get('memory-kind') === 'working' &&
      typeof metadata.get('expires') === 'string' &&
      String(metadata.get('expires')) < today
    ) {
      expiredWorking.push(name);
    }
    if (closedStatuses.has(status)) closed.push(name);
  }
  const inputs = inputDiagnostics(documents);

  return {
    version: 1,
    root,
    totalFiles: files.length,
    unindexed: unindexed.sort(),
    expiredWorking: expiredWorking.sort(),
    closed: closed.sort(),
    duplicateTitles: duplicateActiveTitles(documents),
    supersessionCycles: findSupersessionCycles(documents),
    activeInputCount: inputs.activeInputCount,
    legacyInputs: inputs.legacyInputs.sort(),
    genericActionInputs: inputs.genericActionInputs.sort(),
    workstreamInputs: inputs.workstreamInputs.sort(),
  };
}

export function memoryMaintenanceWarnings(report: MemoryMaintenanceReport): string[] {
  return [
    ...report.expiredWorking.map((path) => `expired: ${path}`),
    ...report.closed.map((path) => `archive candidate: ${path}`),
    ...report.duplicateTitles.map(
      ({ title, paths }) => `duplicate title: ${title} (${paths.join(', ')})`,
    ),
    ...report.supersessionCycles.map((cycle) => `supersession cycle: ${cycle.join(' -> ')}`),
    ...report.legacyInputs.map((path) => `legacy input: ${path}`),
    ...report.genericActionInputs.map((path) => `generic action input: ${path}`),
    ...report.workstreamInputs.map((path) => `active workstream input: ${path}`),
  ];
}

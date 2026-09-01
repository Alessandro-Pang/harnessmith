import { existsSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve } from 'node:path';
import { parseFrontmatterDocument } from './frontmatter.js';
import { type MemoryCoreBudgetReport, memoryCoreBudget } from './memory-core-budget.js';
import { purposeMaintenanceDiagnostics } from './memory-document-purpose.js';
import {
  analyzeMaintenanceDocuments,
  type MaintenanceParsedDocument,
} from './memory-maintenance-analysis.js';
import {
  buildMemoryMaintenanceCandidates,
  type MemoryMaintenanceCandidate,
  summarizeMemoryMaintenance,
} from './memory-maintenance-candidates.js';
import { isInside, markdownFiles, readMemoryDocument } from './memory-path.js';
import {
  contentMemoryReferences,
  isOpaqueMemoryContent,
  metadataReferences,
} from './memory-validation.js';

export interface MemoryMaintenanceReport {
  version: 2;
  mode: 'report-only';
  root: string;
  totalFiles: number;
  scan: { status: 'complete'; filesExamined: number };
  execution: { status: 'succeeded'; reasonCode: 'report-generated' };
  mutation: { status: 'unchanged'; reasonCode: 'report-only' };
  summary: ReturnType<typeof summarizeMemoryMaintenance>;
  candidates: MemoryMaintenanceCandidate[];
  eligibility: {
    status: 'not-evaluated';
    evaluated: 0;
    notEvaluated: number;
    total: number;
    coverage: 0;
    reasonCode: 'maintenance-eligibility-input-unavailable';
  };
  unindexed: string[];
  expiredWorking: string[];
  closed: string[];
  duplicateTitles: Array<{ title: string; paths: string[] }>;
  supersessionCycles: string[][];
  activeInputCount: number;
  legacyInputs: string[];
  genericActionInputs: string[];
  workstreamInputs: string[];
  genericDescriptions: string[];
  duplicatePurposes: Array<{ purpose: string; paths: string[] }>;
  splitProposals: Array<{ path: string; reasons: string[] }>;
  coreBudget: MemoryCoreBudgetReport;
}

function portablePath(root: string, path: string): string {
  return relative(root, path).replaceAll('\\', '/');
}

function referenceIdentity(value: string): string {
  return value
    .replace(/^memory:/, '')
    .replace(/\.md$/, '')
    .toLowerCase();
}

function readDocuments(root: string, files: string[]): MaintenanceParsedDocument[] {
  return files.map((path) => {
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
}

function reachableReferences(documents: MaintenanceParsedDocument[]): Set<string> {
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
  return reachable;
}

function lifecycleLists(documents: MaintenanceParsedDocument[], today: string) {
  const reachable = reachableReferences(documents);
  const unindexed: string[] = [];
  const expiredWorking: string[] = [];
  const closed: string[] = [];
  for (const { name, metadata } of documents) {
    if (name === 'README.md' || name === 'core.md') continue;
    const status = String(metadata.get('status') || '');
    const active = ['active', 'blocked'].includes(status);
    if (active && !reachable.has(referenceIdentity(name))) unindexed.push(name);
    if (
      active &&
      metadata.get('memory-kind') === 'working' &&
      typeof metadata.get('expires') === 'string' &&
      String(metadata.get('expires')) < today
    ) {
      expiredWorking.push(name);
    }
    if (['complete', 'superseded'].includes(status)) closed.push(name);
  }
  return {
    unindexed: unindexed.sort(),
    expiredWorking: expiredWorking.sort(),
    closed: closed.sort(),
  };
}

function missingSourceRefs(root: string, sourceRefs: string[]): string[] {
  if (basename(root) !== '.agent-docs') return [];
  const project = dirname(root);
  return sourceRefs.filter((reference) => {
    if (
      !reference ||
      isAbsolute(reference) ||
      reference.includes(':') ||
      /^<.*>$/u.test(reference)
    ) {
      return false;
    }
    const target = resolve(project, reference);
    return isInside(project, target) && !existsSync(target);
  });
}

export function memoryMaintenanceReport(root: string, today: string): MemoryMaintenanceReport {
  const files = markdownFiles(root, { archive: false });
  const documents = readDocuments(root, files);
  const lifecycle = lifecycleLists(documents, today);
  const analysis = analyzeMaintenanceDocuments(documents);
  const purposes = purposeMaintenanceDiagnostics(documents);
  const corePath = files.find((path) => portablePath(root, path) === 'core.md');
  if (!corePath) throw new Error(`Memory core is missing: ${root}`);

  const legacy = {
    ...lifecycle,
    ...analysis,
    ...purposes,
    coreBudget: memoryCoreBudget(readMemoryDocument(corePath)),
  };
  const candidates = buildMemoryMaintenanceCandidates(
    legacy,
    documents.map(({ name, metadata, references }) => ({
      name,
      documentType: String(metadata.get('type') || ''),
      status: String(metadata.get('status') || ''),
      memoryKind: String(metadata.get('memory-kind') || ''),
      sourceRefs: Array.isArray(metadata.get('source-refs'))
        ? (metadata.get('source-refs') as unknown[]).filter(
            (value): value is string => typeof value === 'string' && value.trim().length > 0,
          )
        : [],
      missingSourceRefs: missingSourceRefs(
        root,
        Array.isArray(metadata.get('source-refs'))
          ? (metadata.get('source-refs') as unknown[]).filter(
              (value): value is string => typeof value === 'string' && value.trim().length > 0,
            )
          : [],
      ),
      references,
    })),
  );

  return {
    version: 2,
    mode: 'report-only',
    root,
    totalFiles: files.length,
    scan: { status: 'complete', filesExamined: files.length },
    execution: { status: 'succeeded', reasonCode: 'report-generated' },
    mutation: { status: 'unchanged', reasonCode: 'report-only' },
    summary: summarizeMemoryMaintenance(candidates),
    candidates,
    eligibility: {
      status: 'not-evaluated',
      evaluated: 0,
      notEvaluated: candidates.length,
      total: candidates.length,
      coverage: 0,
      reasonCode: 'maintenance-eligibility-input-unavailable',
    },
    ...legacy,
  };
}

export { memoryMaintenanceWarnings } from './memory-maintenance-warnings.js';

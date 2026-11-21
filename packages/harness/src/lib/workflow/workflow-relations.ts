import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import {
  buildWorkflowRelationReport,
  type MemoryRelationInput,
  type WorkflowRelationReport,
} from '../contract/workflow-relations.js';
import { parseFrontmatter } from '../documentation/frontmatter.js';
import { listFiles } from '../filesystem/file-discovery.js';
import { assertSafePath, canonicalPath } from '../filesystem/safe-path.js';
import {
  type CurationDocument,
  loadCurationDocuments,
} from '../memory/memory-curation-documents.js';
import { isInside, readMemoryDocument } from '../memory/memory-path.js';
import { readTask } from '../task/task-store.js';

/**
 * I/O composition for workflow relations. The pure report contract (types,
 * task reference parsing, handoff transition rule, report builder) lives in
 * `lib/contract/workflow-relations.ts` and is re-exported here so existing
 * import paths keep working.
 */
export {
  buildWorkflowRelationReport,
  otherTaskOwners,
  taskReferences,
  type WorkflowRelationReport,
} from '../contract/workflow-relations.js';

export function assertAcceptanceEvidenceRole(projectRoot: string, file: string): void {
  const canonicalRoot = canonicalPath(projectRoot);
  const absolute = canonicalPath(resolve(canonicalRoot, file));
  const memoryRoot = join(canonicalRoot, '.agent-docs');
  if (extname(absolute).toLowerCase() !== '.md' || !isInside(memoryRoot, absolute)) return;
  assertSafePath(canonicalRoot, absolute);
  if (parseFrontmatter(readMemoryDocument(absolute)).get('type') === 'session-handoff') {
    throw new Error('Handoff recovery state cannot be used as acceptance evidence');
  }
}

function relationDocument(document: CurationDocument): MemoryRelationInput {
  return {
    reference: document.reference,
    type: document.type,
    kind: document.kind,
    status: document.status,
    ...(document.workstream === undefined ? {} : { workstream: document.workstream }),
    ...(document.session === undefined ? {} : { session: document.session }),
    ...(document.taskId === undefined ? {} : { taskId: document.taskId }),
    sourceRefs: document.sourceRefs,
  };
}

export function workflowRelationsForProject(
  projectRoot: string,
  memoryRoot = join(projectRoot, '.agent-docs'),
): WorkflowRelationReport {
  const workingRoot = join(memoryRoot, 'working');
  const tasks = existsSync(workingRoot)
    ? listFiles(workingRoot)
        .filter((path) => basename(path) === 'task.json')
        .map((path) => readTask(projectRoot, basename(dirname(path))).value)
        .map(({ id, status }) => ({ id, status }))
    : [];
  return buildWorkflowRelationReport(
    tasks,
    loadCurationDocuments(memoryRoot).map(relationDocument),
  );
}

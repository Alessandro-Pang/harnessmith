import { existsSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import type { TaskStatus } from '../types.js';
import { listFiles } from './file-discovery.js';
import { parseFrontmatter } from './frontmatter.js';
import { type CurationDocument, loadCurationDocuments } from './memory-curation-documents.js';
import { isInside, readMemoryDocument } from './memory-path.js';
import { assertSafePath, canonicalPath } from './safe-path.js';
import { readTask } from './task-store.js';

export interface TaskRelationInput {
  id: string;
  status: TaskStatus;
}

export interface MemoryRelationInput {
  reference: string;
  type: string;
  kind: string;
  status: string;
  workstream?: string;
  session?: string;
  taskId?: string;
  sourceRefs: string[];
}

type WorkflowRelationConflictCode =
  | 'orphan-task-reference'
  | 'cross-workstream-binding'
  | 'session-task-conflict';

export interface WorkflowRelationReport {
  version: 1;
  schema: 'urn:agent-harness:schema:workflow-relations:v1';
  mode: 'report-only';
  sourceOfTruth: false;
  tasks: Array<{ task: string; workstream: string; phase: string; status: TaskStatus }>;
  memory: Array<{
    reference: string;
    lifecycleRole:
      | 'task-progress'
      | 'workstream-state'
      | 'durable-knowledge'
      | 'recovery-state'
      | 'other';
    owners: string[];
    taskRefs: string[];
    workstream: string | null;
    session: string | null;
  }>;
  conflicts: Array<{
    code: WorkflowRelationConflictCode;
    reference: string;
    evidence: string[];
    risk: 'medium' | 'high';
  }>;
  summary: { tasks: number; memory: number; conflicts: number };
}

export function taskReferences(sourceRefs: string[]): string[] {
  return [
    ...new Set(
      sourceRefs.flatMap((reference) => {
        const match = /^task:([^\s:]+)$/u.exec(reference.trim());
        return match ? [match[1]] : [];
      }),
    ),
  ].sort();
}

export function otherTaskOwners(sourceRefs: string[], task: string): string[] {
  return taskReferences(sourceRefs).filter((owner) => owner !== task);
}

export function assertHandoffTaskTransition(
  previousTask: string | undefined,
  currentTask: string | undefined,
  reason: string,
): void {
  if (previousTask && currentTask && previousTask !== currentTask && reason !== 'multi-task') {
    throw new Error(
      `Checkpoint reason multi-task is required for Handoff task transition from ${previousTask} to ${currentTask}`,
    );
  }
}

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

function lifecycleRole(
  document: MemoryRelationInput,
): WorkflowRelationReport['memory'][number]['lifecycleRole'] {
  if (document.type === 'session-handoff') return 'recovery-state';
  if (document.kind === 'distilled') return 'durable-knowledge';
  if (document.kind === 'input' && document.workstream) return 'workstream-state';
  if (document.kind === 'working') return 'task-progress';
  return 'other';
}

export function buildWorkflowRelationReport(
  tasks: TaskRelationInput[],
  documents: MemoryRelationInput[],
): WorkflowRelationReport {
  const taskIds = new Set(tasks.map(({ id }) => id));
  const memory = documents.map((document) => {
    const taskRefs = taskReferences([
      ...document.sourceRefs,
      ...(document.taskId ? [`task:${document.taskId}`] : []),
    ]);
    const owners = [
      ...taskRefs.map((task) => `task:${task}`),
      ...(document.workstream ? [`workstream:${document.workstream}`] : []),
      ...(document.session ? [`session:${document.session}`] : []),
    ];
    return {
      reference: document.reference,
      lifecycleRole: lifecycleRole(document),
      owners: [...new Set(owners)],
      taskRefs,
      workstream: document.workstream ?? null,
      session: document.session ?? null,
    };
  });
  const conflicts: WorkflowRelationReport['conflicts'] = [];
  for (const relation of memory) {
    for (const task of relation.taskRefs.filter((task) => !taskIds.has(task))) {
      conflicts.push({
        code: 'orphan-task-reference',
        reference: relation.reference,
        evidence: [`task:${task}`],
        risk: 'high',
      });
    }
    if (
      relation.workstream &&
      relation.taskRefs.length === 1 &&
      relation.workstream !== relation.taskRefs[0]
    ) {
      conflicts.push({
        code: 'cross-workstream-binding',
        reference: relation.reference,
        evidence: [`task:${relation.taskRefs[0]}`, `workstream:${relation.workstream}`],
        risk: 'high',
      });
    }
  }
  const taskRelations = [...tasks]
    .sort((left, right) => left.id.localeCompare(right.id))
    .map(({ id, status }) => ({
      task: id,
      workstream: id,
      phase: `${id}:phase:current`,
      status,
    }));
  return {
    version: 1,
    schema: 'urn:agent-harness:schema:workflow-relations:v1',
    mode: 'report-only',
    sourceOfTruth: false,
    tasks: taskRelations,
    memory,
    conflicts,
    summary: { tasks: taskRelations.length, memory: memory.length, conflicts: conflicts.length },
  };
}

function relationDocument(document: CurationDocument): MemoryRelationInput {
  return {
    reference: document.reference,
    type: document.type,
    kind: document.kind,
    status: document.status,
    workstream: document.workstream,
    session: document.session,
    taskId: document.taskId,
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

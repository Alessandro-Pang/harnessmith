import { basename } from 'node:path';
import type {
  AcceptanceStatus,
  ProjectSnapshot,
  TaskRecord,
  TaskStatus,
  TaskSummary,
} from '../../types.js';
import { escapeCoreLabel } from '../contract/core-label.js';
import { toSlug } from '../contract/slug.js';
import { isPortableIdentityComponent } from '../filesystem/portable-path-component.js';
import { evidenceSupportsPass, taskBaselineDrift } from './task-evidence.js';

export interface TaskBaseOptions {
  project?: string;
  id?: string;
  json?: boolean;
}

export interface InitTaskOptions extends TaskBaseOptions {
  objective?: string;
  acceptance?: string[];
  nextAction?: string;
}

export interface CheckpointOptions extends TaskBaseOptions {
  summary?: string;
  nextAction?: string | undefined;
  status?: TaskStatus | undefined;
  evidence?: string[];
}

export interface AcceptanceOptions extends TaskBaseOptions {
  criterion?: string;
  status?: AcceptanceStatus;
  evidence?: string[];
}

export interface VerifyAcceptanceOptions extends TaskBaseOptions {
  criterion?: string;
  type?: 'command' | 'test' | 'file' | 'diff';
  command?: string;
  args?: string[];
  scope?: string[];
  file?: string;
  timeoutMs?: number;
}

const taskStatuses = new Set<TaskStatus>([
  'pending',
  'in_progress',
  'blocked',
  'complete',
  'superseded',
]);
const acceptanceStatuses = new Set<AcceptanceStatus>([
  'pending',
  'passed',
  'failed',
  'inconclusive',
]);
const checkpointStatuses = new Set<TaskStatus>(['pending', 'in_progress', 'blocked']);

export function now(): string {
  return new Date().toISOString();
}

export function isTaskStatus(value: TaskStatus): boolean {
  return taskStatuses.has(value);
}

export function isAcceptanceStatus(value: AcceptanceStatus): boolean {
  return acceptanceStatuses.has(value);
}

export function isCheckpointStatus(value: TaskStatus): boolean {
  return checkpointStatuses.has(value);
}

function slug(value: string): string {
  // Task ids keep their historical generation: no NFKC normalization and
  // host-neutral `und` case folding. Do not unify these with memory slugs.
  return toSlug(value, { fallback: 'task', normalize: false, localeLowercase: true });
}

export function defaultTaskId(objective: string): string {
  const stamp = now().replace(/[-:]/g, '').replace(/T/, '-').slice(0, 13);
  return `${stamp}-${slug(objective)}`;
}

export function assertPortableTaskId(id: string): void {
  if (!isPortableIdentityComponent(id)) throw new Error(`Invalid task id: ${id}`);
}

export function assertTaskMutable(task: TaskRecord): void {
  if (task.status === 'complete' || task.status === 'superseded') {
    throw new Error(`Task is already closed with status ${task.status}: ${task.id}`);
  }
}

function expiryDate(value: string): string {
  const date = new Date(value);
  date.setUTCDate(date.getUTCDate() + 30);
  return date.toISOString().slice(0, 10);
}

function taskMemoryStatus(status: TaskStatus): 'active' | 'blocked' | 'complete' | 'superseded' {
  if (status === 'blocked' || status === 'complete' || status === 'superseded') return status;
  return 'active';
}

export function progressDocument(task: TaskRecord, owner: string): string {
  const date = task.created.slice(0, 10);
  const objective = escapeCoreLabel(task.objective);
  return `---
title: ${JSON.stringify(objective)}
description: ${JSON.stringify(`Long-running task progress: ${objective}`)}
type: working-note
memory-kind: working
status: ${taskMemoryStatus(task.status)}
owners: [${JSON.stringify(owner)}]
created: ${date}
updated: ${date}
expires: ${expiryDate(task.created)}
project: ${JSON.stringify(basename(task.projectRoot))}
tags: ["task-ledger"]
scope: []
source-refs: [${JSON.stringify(`task:${task.id}`)}]
source-of-truth: false
document-purpose: ${JSON.stringify(objective)}
document-purpose-schema-version: 1
schema-version: 1
---

# ${objective}

`;
}

export function updateProgressFrontmatter(task: TaskRecord, time: string) {
  return {
    status: taskMemoryStatus(task.status),
    updated: time.slice(0, 10),
    expires: expiryDate(time),
  };
}

export function taskSummary(task: TaskRecord, snapshot: ProjectSnapshot): TaskSummary {
  return {
    id: task.id,
    objective: task.objective,
    status: task.status,
    updated: task.updated,
    nextAction: task.nextAction || '',
    acceptance: task.acceptance.map((criterion) => {
      let stale = false;
      if (criterion.status === 'passed') {
        try {
          stale = !criterion.evidence.some((evidence) =>
            evidenceSupportsPass(evidence, task, snapshot, criterion.id),
          );
        } catch {
          stale = true;
        }
      }
      return { ...criterion, stale };
    }),
    lastCheckpoint: task.checkpoints.at(-1) || null,
    baselineDrift: taskBaselineDrift(task, snapshot),
  };
}

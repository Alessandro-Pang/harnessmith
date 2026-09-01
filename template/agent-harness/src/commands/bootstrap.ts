import {
  type BootstrapMemoryRead,
  type BootstrapMetadata,
  type BootstrapState,
  bootstrapMetadataLimit,
  bootstrapRecommendationLimit,
  readBootstrapMemory,
  recommendedBootstrapReads,
} from '../lib/bootstrap-memory.js';
import { listFiles } from '../lib/files.js';
import { projectSnapshot } from '../lib/project.js';
import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import { taskSummary } from '../lib/task-model.js';
import { readTask } from '../lib/task-store.js';
import type { Io, ProjectSnapshot, Runtime, TaskSummary } from '../types.js';

export { bootstrapMetadataLimit } from '../lib/bootstrap-memory.js';

const bootstrapTaskLimit = 32;

export interface BootstrapReport {
  version: 1;
  project: ProjectSnapshot;
  memory: {
    state: BootstrapState;
    root: string;
    metadata: BootstrapMetadata[];
    core: BootstrapMemoryRead['core'];
    maintenance: BootstrapMemoryRead['maintenance'];
    recommended: string[];
  };
  tasks: { state: 'ok' | 'skipped' | 'inconclusive'; active: TaskSummary[] };
  scan: {
    maxMetadata: number;
    maxTasks: number;
    maxRecommendations: number;
    discoveredMetadata: number;
    discoveredTasks: number;
  };
  truncated: boolean;
  reasons: string[];
}

function readBootstrapTasks(snapshot: ProjectSnapshot, reasons: string[]) {
  if (!snapshot.memory.initialized) {
    return { state: 'skipped' as const, active: [] as TaskSummary[], discovered: 0 };
  }
  try {
    const working = join(snapshot.root, '.agent-docs', 'working');
    const listed = existsSync(working)
      ? listFiles(working)
          .filter((path) => basename(path) === 'task.json')
          .map((path) => readTask(snapshot.root, basename(dirname(path))))
          .map(({ value, snapshot: current }) => taskSummary(value, current))
          .sort((left, right) => right.updated.localeCompare(left.updated))
      : [];
    const active = listed.filter(({ status }) =>
      ['pending', 'in_progress', 'blocked'].includes(status),
    );
    if (active.length > bootstrapTaskLimit) {
      reasons.push(
        `Active tasks truncated: ${active.length} discovered, ${bootstrapTaskLimit} returned`,
      );
    }
    return {
      state: 'ok' as const,
      active: active.slice(0, bootstrapTaskLimit),
      discovered: active.length,
    };
  } catch (error) {
    reasons.push(`Active tasks inconclusive: ${String(error)}`);
    return { state: 'inconclusive' as const, active: [] as TaskSummary[], discovered: 0 };
  }
}

function outputBootstrap(report: BootstrapReport, json: boolean, io: Io): void {
  if (json) {
    io.log(JSON.stringify(report, null, 2));
    return;
  }
  io.log(`Bootstrap: ${report.project.root}`);
  io.log(`Project: ${report.project.isGitRepository ? 'git' : 'non-git'}`);
  io.log(`Memory: ${report.memory.state}`);
  io.log(`Active tasks: ${report.tasks.active.length}`);
  io.log(`Recommended reads: ${report.memory.recommended.length}`);
  if (report.truncated) io.log('Bootstrap result is truncated');
}

export function bootstrapProject(
  runtime: Runtime,
  project: string,
  { json = false }: { json?: boolean } = {},
  io: Io = console,
): BootstrapReport {
  assertNoHighConfidenceSecret([project], 'Bootstrap request');
  const snapshot = projectSnapshot(project);
  const reasons: string[] = [];
  const memory = readBootstrapMemory(runtime, snapshot, reasons);
  const tasks = readBootstrapTasks(snapshot, reasons);
  const recommended = recommendedBootstrapReads(snapshot.memory.root, memory, reasons);
  const report: BootstrapReport = {
    version: 1,
    project: snapshot,
    memory: {
      state: memory.state,
      root: snapshot.memory.root,
      metadata: memory.metadata,
      core: memory.core,
      maintenance: memory.maintenance,
      recommended,
    },
    tasks: { state: tasks.state, active: tasks.active },
    scan: {
      maxMetadata: bootstrapMetadataLimit,
      maxTasks: bootstrapTaskLimit,
      maxRecommendations: bootstrapRecommendationLimit,
      discoveredMetadata: memory.discoveredMetadata,
      discoveredTasks: tasks.discovered,
    },
    truncated: reasons.some((reason) => /truncated/i.test(reason)),
    reasons,
  };
  outputBootstrap(report, json, io);
  return report;
}

import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

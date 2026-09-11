import {
  type BootstrapMemoryRead,
  type BootstrapMetadata,
  type BootstrapRecommendation,
  type BootstrapState,
  bootstrapBriefRecommendationLimit,
  bootstrapMetadataLimit,
  bootstrapRecommendationLimit,
  readBootstrapMemory,
  recommendedBootstrapReads,
} from '../../lib/bootstrap/bootstrap-memory.js';
import type { DocumentationIntent } from '../../lib/documentation/docs-routing.js';
import { listFiles } from '../../lib/filesystem/files.js';
import { projectSnapshot } from '../../lib/project/project.js';
import { assertNoHighConfidenceSecret } from '../../lib/security/secret-hygiene.js';
import { taskSummary } from '../../lib/task/task-model.js';
import { readTask } from '../../lib/task/task-store.js';
import type { Io, ProjectSnapshot, Runtime, TaskSummary } from '../../types.js';
import { type BootstrapRouteSummary, bootstrapRoute } from './bootstrap-route.js';

export { bootstrapMetadataLimit } from '../../lib/bootstrap/bootstrap-memory.js';

const bootstrapTaskLimit = 32;
const bootstrapBriefTaskLimit = 4;

type BootstrapDetail = 'brief' | 'full';

interface BootstrapReportBase {
  version: 2;
  detail: BootstrapDetail;
  /** Installed skill entry; the discovery layer for agents that arrived without the always-on entry. */
  skill: string;
  /** Present when the startup command received the user's raw request. */
  route: BootstrapRouteSummary | null;
  project: ProjectSnapshot;
  tasks: { state: 'ok' | 'skipped' | 'inconclusive'; active: TaskSummary[] };
  scan: {
    maxMetadata: number;
    maxTasks: number;
    maxBriefTasks: number;
    maxRecommendations: number;
    maxBriefRecommendations: number;
    discoveredMetadata: number;
    discoveredTasks: number;
    discoveredRecommendations: number;
  };
  omitted: { sections: string[]; activeTasks: number; recommendations: number };
  truncated: boolean;
  reasons: string[];
}

interface BootstrapMemorySummary {
  state: BootstrapState;
  root: string;
  recommended: string[];
  recommendations: BootstrapRecommendation[];
}

export interface BootstrapBriefReport extends BootstrapReportBase {
  detail: 'brief';
  memory: BootstrapMemorySummary;
}

export interface BootstrapFullReport extends BootstrapReportBase {
  detail: 'full';
  memory: BootstrapMemorySummary & {
    metadata: BootstrapMetadata[];
    core: BootstrapMemoryRead['core'];
    maintenance: BootstrapMemoryRead['maintenance'];
  };
}

export type BootstrapReport = BootstrapBriefReport | BootstrapFullReport;

export interface BootstrapOptions {
  detail?: BootstrapDetail;
  json?: boolean;
  /** The user's current request, verbatim; routes documentation inside the same command. */
  query?: string[];
  intent?: DocumentationIntent;
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
  io.log(`Detail: ${report.detail}`);
  io.log(`Project: ${report.project.isGitRepository ? 'git' : 'non-git'}`);
  io.log(`Memory: ${report.memory.state}`);
  io.log(`Active tasks: ${report.tasks.active.length}`);
  io.log(`Recommended reads: ${report.memory.recommended.length}`);
  if (report.truncated) io.log('Bootstrap result is truncated');
  if (report.route) {
    io.log(
      `Route: ${report.route.status}${report.route.primaryPlaybook ? ` ${basename(report.route.primaryPlaybook, '.md')}` : ''}`,
    );
    for (const path of report.route.load) io.log(`Load: ${path}`);
    if (report.route.ask) io.log(`Ask: ${report.route.ask}`);
  }
}

export function bootstrapProject(
  runtime: Runtime,
  project: string,
  options: BootstrapOptions & { detail: 'full' },
  io?: Io,
): BootstrapFullReport;
export function bootstrapProject(
  runtime: Runtime,
  project: string,
  options?: BootstrapOptions & { detail?: 'brief' },
  io?: Io,
): BootstrapBriefReport;
export function bootstrapProject(
  runtime: Runtime,
  project: string,
  options: BootstrapOptions,
  io?: Io,
): BootstrapReport;
export function bootstrapProject(
  runtime: Runtime,
  project: string,
  { detail = 'brief', json = false, query = [], intent }: BootstrapOptions = {},
  io: Io = console,
): BootstrapReport {
  assertNoHighConfidenceSecret([project], 'Bootstrap request');
  const route = query.length > 0 ? bootstrapRoute(runtime, query, intent) : null;
  const snapshot = projectSnapshot(project);
  const reasons: string[] = [];
  const memory = readBootstrapMemory(runtime, snapshot, reasons);
  const tasks = readBootstrapTasks(snapshot, reasons);
  const recommendationLimit =
    detail === 'brief' ? bootstrapBriefRecommendationLimit : bootstrapRecommendationLimit;
  const recommendationRead = recommendedBootstrapReads(
    snapshot.memory.root,
    memory,
    reasons,
    recommendationLimit,
  );
  const activeTaskLimit = detail === 'brief' ? bootstrapBriefTaskLimit : bootstrapTaskLimit;
  const activeTasks = tasks.active.slice(0, activeTaskLimit);
  const memorySummary: BootstrapMemorySummary = {
    state: memory.state,
    root: snapshot.memory.root,
    recommended: recommendationRead.recommendations.map(({ reference }) => reference),
    recommendations: recommendationRead.recommendations,
  };
  const common = {
    version: 2 as const,
    skill: join(runtime.installedHarness, 'SKILL.md'),
    route,
    project: snapshot,
    tasks: { state: tasks.state, active: activeTasks },
    scan: {
      maxMetadata: bootstrapMetadataLimit,
      maxTasks: bootstrapTaskLimit,
      maxBriefTasks: bootstrapBriefTaskLimit,
      maxRecommendations: bootstrapRecommendationLimit,
      maxBriefRecommendations: bootstrapBriefRecommendationLimit,
      discoveredMetadata: memory.discoveredMetadata,
      discoveredTasks: tasks.discovered,
      discoveredRecommendations: recommendationRead.discovered,
    },
    omitted: {
      sections: detail === 'brief' ? ['memory.metadata', 'memory.core', 'memory.maintenance'] : [],
      activeTasks: Math.max(0, tasks.discovered - activeTasks.length),
      recommendations: Math.max(
        0,
        recommendationRead.discovered - recommendationRead.recommendations.length,
      ),
    },
    truncated: reasons.some((reason) => /truncated/i.test(reason)),
    reasons,
  };
  const report: BootstrapReport =
    detail === 'full'
      ? {
          ...common,
          detail: 'full',
          memory: {
            ...memorySummary,
            metadata: memory.metadata,
            core: memory.core,
            maintenance: memory.maintenance,
          },
          omitted: { ...common.omitted, sections: [] },
        }
      : { ...common, detail: 'brief', memory: memorySummary };
  outputBootstrap(report, json, io);
  return report;
}

import { existsSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';

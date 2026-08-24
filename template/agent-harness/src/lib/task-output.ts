import type { Io, TaskSummary } from '../types.js';

export function outputTask(value: TaskSummary | TaskSummary[], json: boolean, io: Io): void {
  if (json) {
    io.log(JSON.stringify(value, null, 2));
    return;
  }
  if (Array.isArray(value)) {
    for (const task of value) {
      io.log(`${task.id} | ${task.status} | ${task.updated} | ${task.objective}`);
    }
    return;
  }
  io.log(`Task: ${value.id}`);
  io.log(`Status: ${value.status}`);
  io.log(`Objective: ${value.objective}`);
  io.log(`Next: ${value.nextAction || 'none'}`);
  const drift = (['branch', 'head', 'dirty'] as const).filter(
    (field) => value.baselineDrift[field],
  );
  if (drift.length > 0) {
    io.log(
      `Baseline drift: ${drift.join(', ')} (current branch=${value.baselineDrift.currentBranch || 'none'}, HEAD=${value.baselineDrift.currentHead || 'none'}, dirty=${String(value.baselineDrift.currentDirty)})`,
    );
  }
  for (const criterion of value.acceptance || []) {
    io.log(
      `  ${criterion.id} | ${criterion.status}${criterion.stale ? ' | stale' : ''} | ${criterion.description}`,
    );
  }
}

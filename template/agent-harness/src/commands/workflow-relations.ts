import { join } from 'node:path';
import { validateMemoryRoot } from '../lib/memory-validation.js';
import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import { projectRoot } from '../lib/task-store.js';
import {
  type WorkflowRelationReport,
  workflowRelationsForProject,
} from '../lib/workflow-relations.js';
import type { Io, Runtime } from '../types.js';

function render(report: WorkflowRelationReport, io: Io): void {
  io.log(
    `Workflow relationships: ${report.summary.tasks} task(s), ${report.summary.memory} memory document(s)`,
  );
  io.log(`Conflicts: ${report.summary.conflicts}`);
  for (const conflict of report.conflicts) {
    io.log(`  ${conflict.code}: ${conflict.reference} (${conflict.evidence.join(', ')})`);
  }
}

export function workflowRelations(
  _runtime: Runtime,
  project: string,
  { json = false }: { json?: boolean } = {},
  io: Io = console,
): WorkflowRelationReport {
  assertNoHighConfidenceSecret([project], 'Workflow relation request');
  const root = projectRoot(project);
  const memoryRoot = join(root, '.agent-docs');
  validateMemoryRoot(memoryRoot, io, { quietSuccess: true, rootKind: 'project' });
  const report = workflowRelationsForProject(root, memoryRoot);
  if (json) io.log(JSON.stringify(report, null, 2));
  else render(report, io);
  return report;
}

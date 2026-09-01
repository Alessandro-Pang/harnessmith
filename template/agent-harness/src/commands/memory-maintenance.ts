import type { MemoryMaintenanceReport } from '../lib/memory-maintenance.js';
import { memoryMaintenanceReport } from '../lib/memory-maintenance.js';
import { resolveMemoryRoot } from '../lib/memory-path.js';
import { validateMemoryRoot } from '../lib/memory-validation.js';
import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import { calendarDate } from '../runtime.js';
import type { Io, Runtime } from '../types.js';

const failureReport = {
  version: 2,
  mode: 'report-only',
  summary: { result: 'inconclusive' },
  scan: { status: 'inconclusive', reasonCode: 'scan-failed' },
  execution: { status: 'failed', reasonCode: 'maintenance-execution-failed' },
  mutation: { status: 'unchanged', reasonCode: 'report-only' },
} as const;

function validateRoot(root: string, rootKind: 'global' | 'project', io: Io): void {
  const errors: string[] = [];
  try {
    validateMemoryRoot(
      root,
      { log: () => undefined, error: (message: unknown = '') => errors.push(String(message)) },
      { quietSuccess: true, rootKind },
    );
  } catch (error) {
    const reportable = (message: string) =>
      message.startsWith('WARNING ') ||
      message.startsWith('Broken memory reference:') ||
      message.startsWith('Memory core exceeds its hard context budget');
    const blocking = errors.filter((message) => !reportable(message));
    if (blocking.length === 0 && errors.some((message) => !message.startsWith('WARNING '))) {
      return;
    }
    for (const message of errors) io.error(message);
    throw error;
  }
}

function renderLegacyDetails(report: MemoryMaintenanceReport, io: Io): void {
  const lists: Array<[string, string[]]> = [
    ['Unindexed active memory', report.unindexed],
    ['Expired working memory', report.expiredWorking],
    ['Closed archive candidates', report.closed],
    ['Legacy inputs', report.legacyInputs],
    ['Generic action inputs', report.genericActionInputs],
    ['Active workstream inputs', report.workstreamInputs],
    ['Generic descriptions', report.genericDescriptions],
  ];
  for (const [label, paths] of lists) {
    io.log(`${label}: ${paths.length}`);
    for (const path of paths) io.log(`  ${path}`);
  }
  io.log(`Duplicate active titles: ${report.duplicateTitles.length}`);
  for (const item of report.duplicateTitles) io.log(`  ${item.title}: ${item.paths.join(', ')}`);
  io.log(`Supersession cycles: ${report.supersessionCycles.length}`);
  for (const cycle of report.supersessionCycles) io.log(`  ${cycle.join(' -> ')}`);
  io.log(`Active inputs: ${report.activeInputCount}`);
  io.log(`Duplicate purposes: ${report.duplicatePurposes.length}`);
  for (const item of report.duplicatePurposes)
    io.log(`  ${item.purpose}: ${item.paths.join(', ')}`);
  io.log(`Split proposals: ${report.splitProposals.length}`);
  for (const item of report.splitProposals) io.log(`  ${item.path}: ${item.reasons.join(', ')}`);
  io.log(
    `Core budget: ${report.coreBudget.status} (${report.coreBudget.lines} lines, ${report.coreBudget.bytes} bytes)`,
  );
  for (const reference of report.coreBudget.compressionCandidates) {
    io.log(`  compression candidate: ${reference}`);
  }
}

function renderReport(report: MemoryMaintenanceReport, io: Io): void {
  io.log(`Memory maintenance: ${report.root}`);
  io.log(`Result: ${report.summary.result}`);
  io.log(`Typed candidates: ${report.summary.totalCandidates}`);
  for (const item of report.candidates) {
    io.log(
      `  ${item.category}/${item.outcome} ${item.reasonCode} -> ${item.suggestedAction} (${item.risk}): ${item.evidence.join(', ')}`,
    );
  }
  io.log(`Eligibility coverage: ${report.eligibility.evaluated}/${report.eligibility.total}`);
  io.log(`Workflow relation conflicts: ${report.relations.summary.conflicts}`);
  renderLegacyDetails(report, io);
}

export function memoryMaintenance(
  runtime: Runtime,
  input = '.',
  { json = false }: { json?: boolean } = {},
  io: Io = console,
): MemoryMaintenanceReport {
  assertNoHighConfidenceSecret([input], 'Memory maintenance request');
  try {
    const root = resolveMemoryRoot(runtime, input);
    validateRoot(root, root === runtime.memoryHome ? 'global' : 'project', io);
    const report = memoryMaintenanceReport(root, calendarDate(runtime));
    if (json) io.log(JSON.stringify(report, null, 2));
    else renderReport(report, io);
    return report;
  } catch (error) {
    if (json) io.log(JSON.stringify(failureReport));
    throw error;
  }
}

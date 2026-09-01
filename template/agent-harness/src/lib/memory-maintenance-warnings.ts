import type { MemoryMaintenanceReport } from './memory-maintenance.js';

export function memoryMaintenanceWarnings(report: MemoryMaintenanceReport): string[] {
  return [
    ...(report.coreBudget.status === 'ok'
      ? []
      : [
          `core context budget: ${report.coreBudget.status} (${report.coreBudget.lines} lines, ${report.coreBudget.bytes} bytes)`,
        ]),
    ...report.coreBudget.compressionCandidates.map(
      (reference) => `core compression candidate: ${reference}`,
    ),
    ...report.expiredWorking.map((path) => `expired: ${path}`),
    ...report.closed.map((path) => `archive candidate: ${path}`),
    ...report.duplicateTitles.map(
      ({ title, paths }) => `duplicate title: ${title} (${paths.join(', ')})`,
    ),
    ...report.supersessionCycles.map((cycle) => `supersession cycle: ${cycle.join(' -> ')}`),
    ...report.legacyInputs.map((path) => `legacy input: ${path}`),
    ...report.genericActionInputs.map((path) => `generic action input: ${path}`),
    ...report.workstreamInputs.map((path) => `active workstream input: ${path}`),
    ...report.genericDescriptions.map((path) => `generic description: ${path}`),
    ...report.duplicatePurposes.map(
      ({ purpose, paths }) => `duplicate purpose: ${purpose} (${paths.join(', ')})`,
    ),
    ...report.splitProposals.map(
      ({ path, reasons }) => `split proposal: ${path} (${reasons.join(', ')})`,
    ),
  ];
}

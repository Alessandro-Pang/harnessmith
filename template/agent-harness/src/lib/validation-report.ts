import type { CheckStatus, ValidationReport } from '../types.js';

export function addCheck(
  report: ValidationReport,
  id: string,
  status: CheckStatus,
  message: string,
  path?: string,
): void {
  report.checks.push({ id, status, message, ...(path ? { path } : {}) });
}

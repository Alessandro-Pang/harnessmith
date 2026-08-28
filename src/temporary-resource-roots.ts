import { tmpdir } from 'node:os';
import { canonicalTemporaryDirectory } from './temporary-resource-marker.js';
import {
  scanTemporaryResources,
  type TemporaryResourceReportItem,
  type TemporaryResourceScanReport,
} from './temporary-resource-scan.js';

export interface TemporaryResourceAggregateReport {
  version: 1;
  action: 'dry-run';
  roots: string[];
  scannedEntries: number;
  truncated: boolean;
  resources: TemporaryResourceReportItem[];
  skipped: Array<{ path: string; reason: string }>;
  reports: TemporaryResourceScanReport[];
}

export function scanTemporaryResourceRoots(
  options: {
    roots?: string[];
    now?: number;
    maxEntries?: number;
    maxBytesPerResource?: number;
    maxResults?: number;
  } = {},
): TemporaryResourceAggregateReport {
  const configured =
    options.roots ?? (process.platform === 'win32' ? [tmpdir()] : [tmpdir(), '/tmp']);
  const roots = [...new Set(configured.map(canonicalTemporaryDirectory))].sort();
  const reports = roots.map((root) =>
    scanTemporaryResources({
      root,
      now: options.now,
      maxEntries: options.maxEntries,
      maxBytesPerResource: options.maxBytesPerResource,
      maxResults: options.maxResults,
    }),
  );
  return {
    version: 1,
    action: 'dry-run',
    roots,
    scannedEntries: reports.reduce((total, report) => total + report.scannedEntries, 0),
    truncated: reports.some(({ truncated }) => truncated),
    resources: reports.flatMap(({ resources }) => resources),
    skipped: reports.flatMap(({ skipped }) => skipped),
    reports,
  };
}

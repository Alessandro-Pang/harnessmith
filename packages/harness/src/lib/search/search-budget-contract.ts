const maxSkipDetails = 50;

export interface SearchScanLimits {
  maxDepth: number;
  maxEntries: number;
  maxDirectories: number;
  maxFiles: number;
  maxFileBytes: number;
  maxTotalBytes: number;
  maxDurationMs: number;
}

const defaultSearchScanLimits: SearchScanLimits = {
  maxDepth: 8,
  maxEntries: 5_000,
  maxDirectories: 1_000,
  maxFiles: 1_000,
  maxFileBytes: 1024 * 1024,
  maxTotalBytes: 8 * 1024 * 1024,
  maxDurationMs: 2_000,
};

type SearchSkipReason =
  | 'max-depth'
  | 'max-entries'
  | 'max-directories'
  | 'max-files'
  | 'max-file-bytes'
  | 'max-total-bytes'
  | 'max-duration'
  | 'stat-error'
  | 'read-error';

export interface SearchSkip {
  source: string;
  path: string;
  reason: SearchSkipReason;
  size?: number;
}

export interface SearchScanStats {
  entriesVisited: number;
  directoriesVisited: number;
  filesVisited: number;
  searchableFiles: number;
  filesRead: number;
  bytesRead: number;
  skipped: number;
  skipDetailsOmitted: number;
  skippedByReason: Record<SearchSkipReason, number>;
}

export interface SearchCandidate {
  source: string;
  sourceIndex: number;
  path: string;
}

export interface SearchDiscovery {
  candidates: SearchCandidate[];
  limits: SearchScanLimits;
  stats: SearchScanStats;
  skipped: SearchSkip[];
  deadline: number;
}

export interface SearchSource {
  root: string;
  label: string;
  excludeDirectories?: string[];
}

function integer(
  value: number | undefined,
  fallback: number,
  name: string,
  minimum: number,
): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < minimum) {
    throw new Error(`${name} must be an integer greater than or equal to ${minimum}`);
  }
  return value;
}

export function resolveSearchScanLimits(options: Partial<SearchScanLimits> = {}): SearchScanLimits {
  return {
    maxDepth: integer(options.maxDepth, defaultSearchScanLimits.maxDepth, 'Search max depth', 0),
    maxEntries: integer(
      options.maxEntries,
      defaultSearchScanLimits.maxEntries,
      'Search max entries',
      1,
    ),
    maxDirectories: integer(
      options.maxDirectories,
      defaultSearchScanLimits.maxDirectories,
      'Search max directories',
      1,
    ),
    maxFiles: integer(options.maxFiles, defaultSearchScanLimits.maxFiles, 'Search max files', 1),
    maxFileBytes: integer(
      options.maxFileBytes,
      defaultSearchScanLimits.maxFileBytes,
      'Search max file bytes',
      1,
    ),
    maxTotalBytes: integer(
      options.maxTotalBytes,
      defaultSearchScanLimits.maxTotalBytes,
      'Search max total bytes',
      1,
    ),
    maxDurationMs: integer(
      options.maxDurationMs,
      defaultSearchScanLimits.maxDurationMs,
      'Search max duration',
      1,
    ),
  };
}

export function emptySearchScanStats(): SearchScanStats {
  return {
    entriesVisited: 0,
    directoriesVisited: 0,
    filesVisited: 0,
    searchableFiles: 0,
    filesRead: 0,
    bytesRead: 0,
    skipped: 0,
    skipDetailsOmitted: 0,
    skippedByReason: {
      'max-depth': 0,
      'max-entries': 0,
      'max-directories': 0,
      'max-files': 0,
      'max-file-bytes': 0,
      'max-total-bytes': 0,
      'max-duration': 0,
      'stat-error': 0,
      'read-error': 0,
    },
  };
}

export function recordSearchSkip(discovery: SearchDiscovery, skip: SearchSkip): void {
  discovery.stats.skipped += 1;
  discovery.stats.skippedByReason[skip.reason] += 1;
  if (discovery.skipped.length < maxSkipDetails) discovery.skipped.push(skip);
  else discovery.stats.skipDetailsOmitted += 1;
}

export function searchDeadlineExceeded(
  discovery: SearchDiscovery,
  source: string,
  path: string,
): boolean {
  if (Date.now() <= discovery.deadline) return false;
  if (discovery.stats.skippedByReason['max-duration'] === 0) {
    recordSearchSkip(discovery, { source, path, reason: 'max-duration' });
  }
  return true;
}

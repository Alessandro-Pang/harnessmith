import {
  emptySearchScanStats,
  resolveSearchScanLimits,
  type SearchDiscovery,
  type SearchScanLimits,
} from './search-budget-contract.js';
import type { SearchScanSource } from './search-source.js';
import { scanSearchSources } from './search-traversal.js';

export {
  recordSearchSkip,
  type SearchCandidate,
  type SearchDiscovery,
  type SearchScanLimits,
  type SearchScanStats,
  type SearchSkip,
  searchDeadlineExceeded,
} from './search-budget-contract.js';

export function discoverSearchableFiles(
  sources: SearchScanSource[],
  options: Partial<SearchScanLimits> = {},
): SearchDiscovery {
  const limits = resolveSearchScanLimits(options);
  const discovery: SearchDiscovery = {
    candidates: [],
    limits,
    stats: emptySearchScanStats(),
    skipped: [],
    deadline: Date.now() + limits.maxDurationMs,
  };
  scanSearchSources(sources, discovery);
  return discovery;
}

import { closeSync, fstatSync, openSync, readSync, type Stats } from 'node:fs';
import {
  recordSearchSkip,
  type SearchCandidate,
  type SearchDiscovery,
  type SearchSkip,
  searchDeadlineExceeded,
} from './search-budget.js';

function skipCandidate(
  discovery: SearchDiscovery,
  candidate: SearchCandidate,
  reason: SearchSkip['reason'],
  size?: number,
): null {
  recordSearchSkip(discovery, { source: candidate.source, path: candidate.path, reason, size });
  return null;
}

export function readSearchCandidate(
  candidate: SearchCandidate,
  discovery: SearchDiscovery,
): string | null {
  if (searchDeadlineExceeded(discovery, candidate.source, candidate.path)) return null;
  let descriptor: number;
  try {
    descriptor = openSync(candidate.path, 'r');
  } catch {
    return skipCandidate(discovery, candidate, 'read-error');
  }
  try {
    if (searchDeadlineExceeded(discovery, candidate.source, candidate.path)) return null;
    let stat: Stats;
    try {
      stat = fstatSync(descriptor);
    } catch {
      return skipCandidate(discovery, candidate, 'stat-error');
    }
    if (searchDeadlineExceeded(discovery, candidate.source, candidate.path)) return null;
    if (!stat.isFile()) return skipCandidate(discovery, candidate, 'stat-error');
    if (stat.size > discovery.limits.maxFileBytes) {
      return skipCandidate(discovery, candidate, 'max-file-bytes', stat.size);
    }
    if (stat.size > discovery.limits.maxTotalBytes - discovery.stats.bytesRead) {
      return skipCandidate(discovery, candidate, 'max-total-bytes', stat.size);
    }
    const content = Buffer.alloc(stat.size);
    let bytesRead = 0;
    while (bytesRead < content.length) {
      if (searchDeadlineExceeded(discovery, candidate.source, candidate.path)) return null;
      const count = readSync(descriptor, content, bytesRead, content.length - bytesRead, null);
      if (count === 0) break;
      bytesRead += count;
    }
    discovery.stats.filesRead += 1;
    discovery.stats.bytesRead += bytesRead;
    const text = content.subarray(0, bytesRead).toString('utf8');
    return searchDeadlineExceeded(discovery, candidate.source, candidate.path) ? null : text;
  } catch {
    return skipCandidate(discovery, candidate, 'read-error');
  } finally {
    try {
      closeSync(descriptor);
    } catch {
      // A failed close does not change the already captured search result.
    }
  }
}

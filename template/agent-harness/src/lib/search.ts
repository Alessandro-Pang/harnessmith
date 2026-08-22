import type { Io } from '../types.js';
import {
  discoverSearchableFiles,
  type SearchScanLimits,
  type SearchScanStats,
  type SearchSkip,
  searchDeadlineExceeded,
} from './search-budget.js';
import { readSearchCandidate } from './search-reader.js';

const defaultLimit = 50;
const defaultMaxLineLength = 400;

export type SearchTrust = 'guidance' | 'untrusted';

export interface SearchSource {
  root: string;
  label: string;
  trust: SearchTrust;
  excludeDirectories?: string[];
}

export interface SearchOptions extends Partial<SearchScanLimits> {
  limit?: number;
  maxLineLength?: number;
}

interface SearchMatch {
  source: string;
  trust: SearchTrust;
  path: string;
  line: number;
  text: string;
  truncated: boolean;
}

export interface SearchReport {
  version: 1;
  query: string;
  limit: number;
  maxLineLength: number;
  truncated: boolean;
  scanTruncated: boolean;
  scanLimits: SearchScanLimits;
  scanStats: SearchScanStats;
  skipped: SearchSkip[];
  matches: SearchMatch[];
}

export function searchableFiles(
  roots: string[],
  options: { excludeDirectories?: string[] } & Partial<SearchScanLimits> = {},
): string[] {
  const discovery = discoverSearchableFiles(
    roots.map((root) => ({
      root,
      label: 'context',
      excludeDirectories: options.excludeDirectories,
    })),
    options,
  );
  return discovery.candidates.map(({ path }) => path).sort();
}

export function textSearch(
  query: string,
  roots: string[],
  io: Io = console,
  options: SearchOptions & {
    excludeDirectories?: string[];
    label?: string;
    trust?: SearchTrust;
  } = {},
): number {
  const report = searchText(
    query,
    roots.map((root) => ({
      root,
      label: options.label || 'context',
      trust: options.trust || 'untrusted',
      excludeDirectories: options.excludeDirectories,
    })),
    options,
  );
  outputSearch(report, io);
  return report.matches.length;
}

function positiveInteger(value: number | undefined, fallback: number, name: string): number {
  if (value === undefined) return fallback;
  if (!Number.isInteger(value) || value < 1) throw new Error(`${name} must be a positive integer`);
  return value;
}

function sanitizeLine(line: string): string {
  return Array.from(line, (character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    const disallowed =
      codePoint <= 8 ||
      (codePoint >= 11 && codePoint <= 12) ||
      (codePoint >= 14 && codePoint <= 31) ||
      codePoint === 127;
    return disallowed ? '�' : character;
  }).join('');
}

function boundedLine(line: string, maxLineLength: number): { text: string; truncated: boolean } {
  const sanitized = sanitizeLine(line);
  if (sanitized.length <= maxLineLength) return { text: sanitized, truncated: false };
  if (maxLineLength === 1) return { text: '…', truncated: true };
  return { text: `${sanitized.slice(0, maxLineLength - 1)}…`, truncated: true };
}

export function searchText(
  query: string,
  sources: SearchSource[],
  options: SearchOptions = {},
): SearchReport {
  const resultLimit = positiveInteger(options.limit, defaultLimit, 'Search limit');
  const lineLimit = positiveInteger(
    options.maxLineLength,
    defaultMaxLineLength,
    'Search line limit',
  );
  const discovery = discoverSearchableFiles(sources, options);
  const needle = query.toLocaleLowerCase();
  const matches: SearchMatch[] = [];
  let truncated = false;
  let scanExpired = searchDeadlineExceeded(
    discovery,
    sources[0]?.label || 'search',
    sources[0]?.root || '<query>',
  );

  candidateLoop: for (const candidate of scanExpired ? [] : discovery.candidates) {
    const content = readSearchCandidate(candidate, discovery);
    if (content === null) {
      scanExpired = searchDeadlineExceeded(discovery, candidate.source, candidate.path);
      if (scanExpired) break;
      continue;
    }
    const lines = content.split(/\r?\n/);
    if (searchDeadlineExceeded(discovery, candidate.source, candidate.path)) break;
    for (const [index, line] of lines.entries()) {
      if (searchDeadlineExceeded(discovery, candidate.source, candidate.path)) break candidateLoop;
      const matchesNeedle = line.toLocaleLowerCase().includes(needle);
      if (searchDeadlineExceeded(discovery, candidate.source, candidate.path)) break candidateLoop;
      if (!matchesNeedle) continue;
      if (matches.length === resultLimit) {
        truncated = true;
        break candidateLoop;
      }
      const bounded = boundedLine(line, lineLimit);
      if (searchDeadlineExceeded(discovery, candidate.source, candidate.path)) break candidateLoop;
      matches.push({
        source: candidate.source,
        trust: sources[candidate.sourceIndex].trust,
        path: candidate.path,
        line: index + 1,
        text: bounded.text,
        truncated: bounded.truncated,
      });
    }
  }

  return {
    version: 1,
    query,
    limit: resultLimit,
    maxLineLength: lineLimit,
    truncated,
    scanTruncated: discovery.stats.skipped > 0,
    scanLimits: discovery.limits,
    scanStats: discovery.stats,
    skipped: discovery.skipped,
    matches,
  };
}

function scanSummary(report: SearchReport): string {
  const reasons = Object.entries(report.scanStats.skippedByReason)
    .filter(([, count]) => count > 0)
    .map(([reason, count]) => `${reason}=${count}`)
    .join(', ');
  return `INFO search scan truncated: ${reasons}; files=${report.scanStats.filesRead}/${report.scanStats.searchableFiles}, bytes=${report.scanStats.bytesRead}/${report.scanLimits.maxTotalBytes}`;
}

export function outputSearch(
  report: SearchReport,
  io: Io = console,
  { json = false }: { json?: boolean } = {},
): void {
  if (json) {
    io.log(JSON.stringify(report, null, 2));
    return;
  }
  for (const match of report.matches) {
    io.log(
      `[${match.trust}:${match.source}] ${JSON.stringify(match.path)}:${match.line}:${JSON.stringify(match.text)}`,
    );
  }
  if (report.truncated) {
    io.log(`INFO search results truncated after ${report.matches.length} matches`);
  }
  if (report.scanTruncated) io.log(scanSummary(report));
}

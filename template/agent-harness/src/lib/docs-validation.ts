import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve, sep } from 'node:path';
import { parse } from 'yaml';
import type { Runtime, ValidationReport } from '../types.js';
import { errorMessage } from '../types.js';
import { listFiles } from './files.js';
import { parseFrontmatter } from './frontmatter.js';
import { markdownLinkTargets } from './markdown-links.js';
import { addCheck } from './validation-report.js';

interface RouteEntry {
  name: string;
  path?: string;
}

function routeEntries(path: string): RouteEntry[] {
  const manifest = parse(readFileSync(path, 'utf8')) as {
    entries?: Record<string, { path?: string }>;
  } | null;
  return Object.entries(manifest?.entries || {}).map(([name, entry]) => ({ name, ...entry }));
}

function validateDocument(path: string, report: ValidationReport): void {
  const content = readFileSync(path, 'utf8');
  try {
    const metadata = parseFrontmatter(content);
    for (const field of ['title', 'type', 'status', 'updated']) {
      if (!metadata.has(field))
        addCheck(report, 'docs-metadata', 'failed', `Missing ${field}`, path);
    }
    const updated = metadata.get('updated');
    const configuredReviewInterval = metadata.get('review-interval-days');
    const reviewInterval = configuredReviewInterval ?? 180;
    if (
      !Number.isInteger(reviewInterval) ||
      typeof reviewInterval !== 'number' ||
      reviewInterval <= 0
    ) {
      addCheck(
        report,
        'docs-metadata',
        'failed',
        'review-interval-days must be a positive integer',
        path,
      );
    }
    if (typeof updated === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(updated)) {
      const age = (Date.now() - new Date(`${updated}T00:00:00Z`).getTime()) / 86_400_000;
      if (typeof reviewInterval === 'number' && reviewInterval > 0 && age > reviewInterval) {
        addCheck(
          report,
          'docs-freshness',
          'warning',
          `Not reviewed for ${Math.floor(age)} days (${reviewInterval}-day interval)`,
          path,
        );
      }
    }
  } catch (error) {
    addCheck(
      report,
      'docs-metadata',
      'failed',
      `Invalid frontmatter: ${errorMessage(error)}`,
      path,
    );
    return;
  }
  for (const target of markdownLinkTargets(content)) {
    if (/^(https?:|#|mailto:)/.test(target)) continue;
    const clean = target.split('#')[0];
    if (clean && !existsSync(resolve(dirname(path), clean))) {
      addCheck(report, 'docs-link', 'failed', `Broken relative link: ${target}`, path);
    }
  }
}

export function validateDocs(runtime: Runtime, report: ValidationReport): void {
  const manifest = join(runtime.docsRoot, 'manifest.yaml');
  if (!existsSync(manifest)) {
    addCheck(report, 'docs-manifest', 'failed', 'Missing docs manifest', manifest);
    return;
  }
  let entries: RouteEntry[];
  try {
    entries = routeEntries(manifest);
  } catch (error) {
    addCheck(report, 'docs-manifest', 'failed', `Invalid YAML: ${errorMessage(error)}`, manifest);
    return;
  }
  const routed = new Set<string>();
  for (const entry of entries) {
    if (!entry.path) {
      addCheck(report, 'docs-route', 'failed', `Route has no path: ${entry.name}`, manifest);
      continue;
    }
    const target = resolve(runtime.docsRoot, entry.path);
    if (target !== runtime.docsRoot && !target.startsWith(`${runtime.docsRoot}${sep}`)) {
      addCheck(report, 'docs-route', 'failed', `Route escapes docs root: ${entry.path}`, manifest);
      continue;
    }
    routed.add(target);
    addCheck(
      report,
      'docs-route',
      existsSync(target) ? 'passed' : 'failed',
      existsSync(target) ? `Route resolves: ${entry.name}` : `Broken route: ${entry.name}`,
      target,
    );
  }
  for (const path of listFiles(runtime.docsRoot).filter((file) => file.endsWith('.md'))) {
    if (path !== join(runtime.docsRoot, 'README.md') && !routed.has(path)) {
      addCheck(report, 'docs-coverage', 'failed', 'Document is not routed by manifest', path);
    }
    validateDocument(path, report);
  }
}

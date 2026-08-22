import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { isPathInside } from './safe-path.js';

interface ManifestEntry {
  path?: unknown;
  triggers?: unknown;
}

interface DocsManifest {
  version?: unknown;
  entries?: unknown;
}

interface DocumentationRoute {
  name: string;
  path: string;
  matchedTriggers: string[];
}

export interface DocumentationRouteReport {
  version: 1;
  query: string[];
  routes: DocumentationRoute[];
}

function normalizedTerms(query: string[]): string[] {
  const terms = query.map(normalizeRoutingText).filter(Boolean);
  if (terms.length === 0) throw new Error('At least one routing term is required');
  return [...new Set(terms)];
}

function normalizeRoutingText(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function matchesRoutingTerm(trigger: string, term: string): boolean {
  const candidate = normalizeRoutingText(trigger);
  if (!candidate) return false;
  if (candidate === term) return true;
  return new RegExp(
    `(?:^|[^\\p{L}\\p{N}])${escapeRegularExpression(candidate)}(?:$|[^\\p{L}\\p{N}])`,
    'u',
  ).test(term);
}

function manifestEntries(value: unknown): Record<string, ManifestEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Documentation manifest entries must be an object');
  }
  return value as Record<string, ManifestEntry>;
}

function routedPath(docsRoot: string, path: string): string {
  const target = resolve(docsRoot, path);
  if (target === resolve(docsRoot) || !isPathInside(docsRoot, target)) {
    throw new Error(`Documentation route escapes docs root: ${path}`);
  }
  return target;
}

export function routeDocumentation(docsRoot: string, query: string[]): DocumentationRouteReport {
  const terms = normalizedTerms(query);
  const manifestPath = resolve(docsRoot, 'manifest.yaml');
  const manifest = parse(readFileSync(manifestPath, 'utf8')) as DocsManifest;
  const entries = manifestEntries(manifest?.entries);
  const routes: DocumentationRoute[] = [];

  for (const [name, rawEntry] of Object.entries(entries)) {
    if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
      throw new Error(`Documentation manifest entry ${name} must be an object`);
    }
    if (typeof rawEntry.path !== 'string' || rawEntry.path.trim() === '') {
      throw new Error(`Documentation manifest entry ${name} has no valid path`);
    }
    if (
      !Array.isArray(rawEntry.triggers) ||
      rawEntry.triggers.some((item) => typeof item !== 'string')
    ) {
      throw new Error(`Documentation manifest entry ${name} has invalid triggers`);
    }
    const triggers = rawEntry.triggers as string[];
    const matchedTriggers = triggers.filter((trigger) =>
      terms.some((term) => matchesRoutingTerm(trigger, term)),
    );
    if (matchedTriggers.length === 0) continue;
    routes.push({
      name,
      path: routedPath(docsRoot, rawEntry.path),
      matchedTriggers,
    });
  }

  return { version: 1, query: terms, routes };
}

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { isPathInside } from './safe-path.js';

interface ManifestEntry {
  kind?: unknown;
  path?: unknown;
  priority?: unknown;
  triggers?: unknown;
}

interface DocsManifest {
  version?: unknown;
  entries?: unknown;
}

interface DocumentationRoute {
  kind: 'playbook' | 'topic' | 'standard';
  name: string;
  path: string;
  priority: number;
  matchedTriggers: string[];
}

export interface DocumentationRouteReport {
  version: 1;
  query: string[];
  routes: DocumentationRoute[];
  primaryPlaybook: DocumentationRoute | null;
  topics: DocumentationRoute[];
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

function routingMatchPositions(candidate: string, term: string): number[] {
  if (/\p{Script=Han}/u.test(candidate)) {
    const positions: number[] = [];
    let offset = 0;
    while (offset <= term.length - candidate.length) {
      const position = term.indexOf(candidate, offset);
      if (position === -1) break;
      positions.push(position);
      offset = position + candidate.length;
    }
    return positions;
  }
  const pattern = new RegExp(
    `(?:^|[^\\p{L}\\p{N}])(${escapeRegularExpression(candidate)})(?=$|[^\\p{L}\\p{N}])`,
    'gu',
  );
  return [...term.matchAll(pattern)].map(
    (match) => (match.index ?? 0) + match[0].length - (match[1]?.length ?? 0),
  );
}

function routingMatchIsNegated(term: string, position: number): boolean {
  const clause =
    term
      .slice(0, position)
      .split(/[,.!?;，。！？；]/u)
      .at(-1) ?? '';
  return /(?:\b(?:do\s+not|don't|not|never|without|no)\s+(?:\p{L}+\s+){0,2}|(?:不要|无需|不必|别|禁止|避免|不)\s*)$/u.test(
    clause,
  );
}

function routingMatchIsRequestedAction(term: string, position: number): boolean {
  const clause =
    term
      .slice(0, position)
      .split(/[,.!?;，。！？；]/u)
      .at(-1) ?? '';
  const prefix = clause.trim();
  if (prefix === '') return true;
  return /(?:\b(?:please|can you|could you|would you|i want you to|i need you to|let(?:'s| us)|now|then|also)\s+(?:\p{L}+\s+){0,4}|(?:请|请你|帮我|给我|现在|继续|重新|开始|进行|执行|来|需要|要求|希望|想要|逐个|并)\s*)$/u.test(
    prefix,
  );
}

function matchesRoutingTerm(trigger: string, term: string): boolean {
  const candidate = normalizeRoutingText(trigger);
  if (!candidate) return false;
  return routingMatchPositions(candidate, term).some(
    (position) => !routingMatchIsNegated(term, position),
  );
}

function matchesPlaybookIntent(trigger: string, term: string): boolean {
  const candidate = normalizeRoutingText(trigger);
  if (!candidate) return false;
  return routingMatchPositions(candidate, term).some(
    (position) =>
      !routingMatchIsNegated(term, position) && routingMatchIsRequestedAction(term, position),
  );
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
    if (!['playbook', 'topic', 'standard'].includes(String(rawEntry.kind))) {
      throw new Error(`Documentation manifest entry ${name} has no valid kind`);
    }
    if (
      rawEntry.priority !== undefined &&
      (typeof rawEntry.priority !== 'number' || !Number.isInteger(rawEntry.priority))
    ) {
      throw new Error(`Documentation manifest entry ${name} has invalid priority`);
    }
    if (
      !Array.isArray(rawEntry.triggers) ||
      rawEntry.triggers.some((item) => typeof item !== 'string')
    ) {
      throw new Error(`Documentation manifest entry ${name} has invalid triggers`);
    }
    const triggers = rawEntry.triggers as string[];
    const kind = rawEntry.kind as DocumentationRoute['kind'];
    const matchedTriggers = triggers.filter((trigger) =>
      terms.some((term) =>
        kind === 'playbook'
          ? matchesPlaybookIntent(trigger, term)
          : matchesRoutingTerm(trigger, term),
      ),
    );
    if (matchedTriggers.length === 0) continue;
    routes.push({
      kind,
      name,
      path: routedPath(docsRoot, rawEntry.path),
      priority: rawEntry.priority ?? 0,
      matchedTriggers,
    });
  }

  const playbooks = routes
    .filter(({ kind }) => kind === 'playbook')
    .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
  const highest = playbooks[0]?.priority;
  const highestRanked = playbooks.filter(({ priority }) => priority === highest);
  if (highestRanked.length > 1) {
    throw new Error(
      `Ambiguous documentation playbooks: ${highestRanked.map(({ name }) => name).join(', ')}`,
    );
  }
  return {
    version: 1,
    query: terms,
    routes,
    primaryPlaybook: playbooks[0] ?? null,
    topics: routes.filter(({ kind }) => kind !== 'playbook'),
  };
}

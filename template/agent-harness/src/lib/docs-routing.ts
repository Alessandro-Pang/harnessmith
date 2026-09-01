import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import {
  type ResponseLanguageContext,
  type ResponseLanguageDecision,
  resolveResponseLanguage,
} from './response-language.js';
import { isPathInside } from './safe-path.js';

interface ManifestEntry {
  actionAliases?: unknown;
  conceptAliases?: unknown;
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
  matchedAliases: string[];
}

export interface DocumentationRouteReport {
  version: 2;
  status: 'matched' | 'unmatched' | 'ambiguous';
  query: string[];
  routes: DocumentationRoute[];
  primaryPlaybook: DocumentationRoute | null;
  top1: DocumentationRoute | null;
  ambiguity: string[];
  topics: DocumentationRoute[];
  responseLanguage: ResponseLanguageDecision;
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
  return /^(?:(?:please|can you|could you|would you|i want you to|i need you to|let(?:'s| us)|now|then|also)(?:\s+\p{L}+){0,4}|(?:请|请你|帮我|给我|现在|继续|重新|开始|进行|执行|来|需要|要求|希望|想要|逐个|并|只)|(?:结合|基于|根据)[\p{L}\p{N} ._-]{0,40}(?:来)?)$/u.test(
    prefix,
  );
}

function routingMatchIsIllustrative(term: string, position: number): boolean {
  const prefix = term.slice(Math.max(0, position - 48), position);
  return /(?:\b(?:for example|e\.g\.|such as)\s*,?\s*|(?:例如|比如|譬如)\s*[：:,，]?\s*)$/u.test(
    prefix,
  );
}

function routingMatchIsQuoted(term: string, position: number): boolean {
  for (const [open, close] of [
    ['“', '”'],
    ['‘', '’'],
    ['「', '」'],
    ['『', '』'],
  ] as const) {
    const opening = term.lastIndexOf(open, position);
    if (opening !== -1) {
      const closing = term.indexOf(close, opening + open.length);
      if (closing >= position) return true;
    }
  }
  for (const quote of ['"', "'"] as const) {
    const before = term.slice(0, position).split(quote).length - 1;
    if (before % 2 === 1 && term.indexOf(quote, position) !== -1) return true;
  }
  return false;
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
      !routingMatchIsNegated(term, position) &&
      !routingMatchIsQuoted(term, position) &&
      !routingMatchIsIllustrative(term, position) &&
      routingMatchIsRequestedAction(term, position),
  );
}

function aliasList(entry: ManifestEntry, kind: DocumentationRoute['kind'], name: string): string[] {
  const canonicalField = kind === 'playbook' ? 'actionAliases' : 'conceptAliases';
  const usesLegacyTriggers = entry[canonicalField] === undefined && entry.triggers !== undefined;
  const field = usesLegacyTriggers ? 'triggers' : canonicalField;
  const aliases = entry[field];
  if (
    !Array.isArray(aliases) ||
    aliases.length === 0 ||
    aliases.some((item) => typeof item !== 'string' || item.trim() === '')
  ) {
    throw new Error(`Documentation manifest entry ${name} has invalid ${field}`);
  }
  return aliases as string[];
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

export function routeDocumentation(
  docsRoot: string,
  query: string[],
  languageContext: ResponseLanguageContext = {},
): DocumentationRouteReport {
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
    const kind = rawEntry.kind as DocumentationRoute['kind'];
    const aliases = aliasList(rawEntry, kind, name);
    const matchedAliases = aliases.filter((alias) =>
      terms.some((term) =>
        kind === 'playbook' ? matchesPlaybookIntent(alias, term) : matchesRoutingTerm(alias, term),
      ),
    );
    if (matchedAliases.length === 0) continue;
    routes.push({
      kind,
      name,
      path: routedPath(docsRoot, rawEntry.path),
      priority: rawEntry.priority ?? 0,
      matchedAliases,
    });
  }

  const playbooks = routes
    .filter(({ kind }) => kind === 'playbook')
    .sort((left, right) => right.priority - left.priority || left.name.localeCompare(right.name));
  const highest = playbooks[0]?.priority;
  const highestRanked = playbooks.filter(({ priority }) => priority === highest);
  const ambiguity = highestRanked.length > 1 ? highestRanked.map(({ name }) => name) : [];
  const primaryPlaybook = ambiguity.length === 0 ? (playbooks[0] ?? null) : null;
  const status = ambiguity.length > 0 ? 'ambiguous' : routes.length > 0 ? 'matched' : 'unmatched';
  return {
    version: 2,
    status,
    query: terms,
    routes,
    primaryPlaybook,
    top1: primaryPlaybook,
    ambiguity,
    topics: routes.filter(({ kind }) => kind !== 'playbook'),
    responseLanguage: resolveResponseLanguage(terms.join(' '), languageContext),
  };
}

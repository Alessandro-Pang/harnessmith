import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { isPathInside } from '../filesystem/safe-path.js';
import {
  type ResponseLanguageContext,
  type ResponseLanguageDecision,
  resolveResponseLanguage,
} from '../routing/response-language.js';
import {
  matchesRoutingTerm,
  normalizeRoutingText,
  playbookAliasEvidence,
} from './docs-routing-matching.js';

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

export const documentationIntents = [
  'change',
  'diagnose',
  'review',
  'research-and-design',
  'release-and-external',
] as const;

export type DocumentationIntent = (typeof documentationIntents)[number];

const maximumDocumentationTopics = 4;

export interface DocumentationRouteOptions {
  intent?: DocumentationIntent;
  languageContext?: ResponseLanguageContext;
}

export interface DocumentationRouteReport {
  version: 3;
  status: 'matched' | 'unmatched' | 'ambiguous';
  query: string[];
  routes: DocumentationRoute[];
  primaryPlaybook: DocumentationRoute | null;
  top1: DocumentationRoute | null;
  ambiguity: string[];
  topics: DocumentationRoute[];
  omittedTopics: DocumentationRoute[];
  intent: {
    requested: string | null;
    source: 'explicit' | 'inferred' | 'none';
    mentionedActions: string[];
    negatedActions: string[];
  };
  responseLanguage: ResponseLanguageDecision;
}

function normalizedTerms(query: string[]): string[] {
  const terms = query.map(normalizeRoutingText).filter(Boolean);
  if (terms.length === 0) throw new Error('At least one routing term is required');
  return [...new Set(terms)];
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

function validatedManifestEntry(name: string, rawEntry: ManifestEntry) {
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
  return {
    kind: rawEntry.kind as DocumentationRoute['kind'],
    path: rawEntry.path,
    priority: rawEntry.priority ?? 0,
  };
}

function boundedDocumentationTopics(routes: DocumentationRoute[]): {
  topics: DocumentationRoute[];
  omittedTopics: DocumentationRoute[];
} {
  const ranked = routes
    .map((route, index) => ({ index, route }))
    .sort(
      (left, right) =>
        right.route.matchedAliases.length - left.route.matchedAliases.length ||
        left.index - right.index,
    )
    .map(({ route }) => route);
  return {
    topics: ranked.slice(0, maximumDocumentationTopics),
    omittedTopics: ranked.slice(maximumDocumentationTopics),
  };
}

export function routeDocumentation(
  docsRoot: string,
  query: string[],
  options: DocumentationRouteOptions = {},
): DocumentationRouteReport {
  const terms = normalizedTerms(query);
  const manifestPath = resolve(docsRoot, 'manifest.yaml');
  const manifest = parse(readFileSync(manifestPath, 'utf8')) as DocsManifest;
  const entries = manifestEntries(manifest?.entries);
  const supportingRoutes: DocumentationRoute[] = [];
  const playbookEvidence = new Map<
    string,
    { route: DocumentationRoute; mentioned: boolean; negated: boolean; requested: boolean }
  >();

  for (const [name, rawEntry] of Object.entries(entries)) {
    const { kind, path, priority } = validatedManifestEntry(name, rawEntry);
    const aliases = aliasList(rawEntry, kind, name);
    if (kind === 'playbook') {
      const evidence = aliases.map((alias) => ({
        alias,
        values: terms.map((term) => playbookAliasEvidence(alias, term)),
      }));
      const route = {
        kind,
        name,
        path: routedPath(docsRoot, path),
        priority,
        matchedAliases: evidence
          .filter(({ values }) => values.some(({ mentioned }) => mentioned))
          .map(({ alias }) => alias),
      };
      playbookEvidence.set(name, {
        route,
        mentioned: evidence.some(({ values }) => values.some(({ mentioned }) => mentioned)),
        negated: evidence.some(({ values }) => values.some(({ negated }) => negated)),
        requested: evidence.some(({ values }) => values.some(({ requested }) => requested)),
      });
      continue;
    }
    const matchedAliases = aliases.filter((alias) =>
      terms.some((term) => matchesRoutingTerm(alias, term)),
    );
    if (matchedAliases.length === 0) continue;
    supportingRoutes.push({
      kind,
      name,
      path: routedPath(docsRoot, path),
      priority,
      matchedAliases,
    });
  }

  const inferred = [...playbookEvidence.values()].filter(({ requested }) => requested);
  const explicit = options.intent ? playbookEvidence.get(options.intent) : undefined;
  if (options.intent && !explicit) {
    throw new Error(`Documentation intent has no playbook route: ${options.intent}`);
  }
  const selected = explicit ? [explicit] : inferred;
  const ambiguity =
    !explicit && selected.length > 1
      ? selected.map(({ route }) => route.name).sort((left, right) => left.localeCompare(right))
      : [];
  const primaryPlaybook = ambiguity.length === 0 ? (selected[0]?.route ?? null) : null;
  const { topics, omittedTopics } = boundedDocumentationTopics(supportingRoutes);
  const routes = [...selected.map(({ route }) => route), ...topics];
  const status = ambiguity.length > 0 ? 'ambiguous' : routes.length > 0 ? 'matched' : 'unmatched';
  const mentionedActions = [...playbookEvidence.entries()]
    .filter(([, { mentioned }]) => mentioned)
    .map(([name]) => name);
  const negatedActions = [...playbookEvidence.entries()]
    .filter(([, { negated }]) => negated)
    .map(([name]) => name);
  return {
    version: 3,
    status,
    query: terms,
    routes,
    primaryPlaybook,
    top1: primaryPlaybook,
    ambiguity,
    topics,
    omittedTopics,
    intent: {
      requested: primaryPlaybook?.name ?? null,
      source: options.intent ? 'explicit' : selected.length > 0 ? 'inferred' : 'none',
      mentionedActions,
      negatedActions,
    },
    responseLanguage: resolveResponseLanguage(terms.join(' '), options.languageContext),
  };
}

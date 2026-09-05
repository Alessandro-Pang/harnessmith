import { existsSync, readFileSync } from 'node:fs';
import { relative, resolve, sep } from 'node:path';
import { normalizeRoutingText } from '../../packages/harness/src/lib/documentation/docs-routing-matching.js';
import { parseFrontmatterDocument } from '../../packages/harness/src/lib/documentation/frontmatter.js';

export interface ManifestEntry {
  actionAliases?: unknown;
  activationRules?: unknown;
  conceptAliases?: unknown;
  kind?: unknown;
  load?: unknown;
  owner?: unknown;
  path?: unknown;
  priority?: unknown;
  requiredConceptAliases?: unknown;
  triggers?: unknown;
}

export interface DocsManifest {
  version?: number;
  entries?: unknown;
}

export const CANONICAL_ROUTE_IDS = [
  'operating-model',
  'execution-loop',
  'tool-routing',
  'safety-and-verification',
  'git-conventions',
  'harness-cli-architecture',
  'long-running-tasks',
  'change',
  'diagnose',
  'review',
  'research-and-design',
  'release-and-external',
  'understand-and-map',
  'verify-and-accept',
  'repository-map',
  'project-agents',
  'project-agent-docs',
  'prompt-rule-contract',
  'user-profile-memory',
] as const;

function manifestEntries(manifest: unknown): Record<string, ManifestEntry> | undefined {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) return undefined;
  const entries = (manifest as DocsManifest).entries;
  return entries && typeof entries === 'object' && !Array.isArray(entries)
    ? (entries as Record<string, ManifestEntry>)
    : undefined;
}

export function missingCanonicalRouteIds(manifest: unknown): string[] {
  const entries = manifestEntries(manifest);
  return CANONICAL_ROUTE_IDS.filter((id) => !entries || !Object.hasOwn(entries, id));
}

function aliasField(entry: ManifestEntry): unknown {
  const aliases = entry.kind === 'playbook' ? entry.actionAliases : entry.conceptAliases;
  return aliases === undefined ? entry.triggers : aliases;
}

function metadataIsInvalid(
  entry: ManifestEntry,
  routeEntries: Record<string, ManifestEntry>,
): boolean {
  const kinds = new Set(['playbook', 'topic', 'standard']);
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return true;
  if (typeof entry.kind !== 'string' || !kinds.has(entry.kind)) return true;
  if (entry.kind === 'playbook') {
    if (!Number.isInteger(entry.priority) || (entry.priority as number) <= 0) return true;
  } else if (entry.priority !== undefined && !Number.isInteger(entry.priority)) {
    return true;
  }
  if (
    entry.load !== undefined &&
    (!['supporting', 'reference'].includes(String(entry.load)) ||
      (entry.kind === 'playbook' && entry.load === 'reference'))
  ) {
    return true;
  }
  if (
    entry.owner !== undefined &&
    (typeof entry.owner !== 'string' ||
      entry.owner.trim().length === 0 ||
      !Object.hasOwn(routeEntries, entry.owner))
  ) {
    return true;
  }
  if (entry.load === 'reference' && typeof entry.owner !== 'string') return true;
  if (entry.load === 'reference' && entry.requiredConceptAliases !== undefined) return true;
  const aliases = aliasField(entry);
  const aliasValues = Array.isArray(aliases)
    ? aliases.filter((alias): alias is string => typeof alias === 'string')
    : [];
  const normalizedAliases = Array.isArray(aliases) ? aliasValues.map(normalizeRoutingText) : [];
  if (Array.isArray(aliases) && new Set(normalizedAliases).size !== aliases.length) return true;
  if (invalidActivationRules(entry)) return true;
  return invalidRequiredAliases(entry, normalizedAliases);
}

function invalidActivationRules(entry: ManifestEntry): boolean {
  if (entry.activationRules === undefined) return false;
  if (
    entry.kind !== 'topic' ||
    entry.load !== 'reference' ||
    !Array.isArray(entry.activationRules) ||
    entry.activationRules.length === 0
  ) {
    return true;
  }
  const modes = new Set<string>();
  for (const value of entry.activationRules) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return true;
    const rule = value as Record<string, unknown>;
    if (
      typeof rule.mode !== 'string' ||
      rule.mode.trim() === '' ||
      modes.has(rule.mode) ||
      !validStringList(rule.aliases) ||
      !validStringList(rule.signals) ||
      !validStringList(rule.requiredArtifacts) ||
      typeof rule.section !== 'string' ||
      rule.section.trim() === '' ||
      !Number.isInteger(rule.minSignals) ||
      (rule.minSignals as number) < 1 ||
      (rule.minSignals as number) > (rule.signals as unknown[]).length
    ) {
      return true;
    }
    modes.add(rule.mode);
  }
  return false;
}

function validStringList(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((item) => typeof item === 'string' && item.trim().length > 0) &&
    new Set(value.map((item) => normalizeRoutingText(item))).size === value.length
  );
}

function invalidRequiredAliases(entry: ManifestEntry, normalizedAliases: string[]): boolean {
  if (entry.requiredConceptAliases === undefined) return false;
  if (
    entry.kind === 'playbook' ||
    !Array.isArray(entry.requiredConceptAliases) ||
    entry.requiredConceptAliases.length === 0 ||
    entry.requiredConceptAliases.some(
      (alias) => typeof alias !== 'string' || alias.trim().length === 0,
    )
  ) {
    return true;
  }
  const normalizedRequired = entry.requiredConceptAliases
    .filter((alias): alias is string => typeof alias === 'string')
    .map(normalizeRoutingText);
  return (
    new Set(normalizedRequired).size !== normalizedRequired.length ||
    normalizedRequired.some((alias) => !normalizedAliases.includes(alias))
  );
}

export function invalidManifestRouteMetadata(manifest: unknown): string[] {
  const entries = manifestEntries(manifest);
  if (!entries) return [];
  return Object.entries(entries)
    .filter(([, entry]) => metadataIsInvalid(entry, entries))
    .map(([id]) => id)
    .sort();
}

interface DocumentRoute {
  id: string;
  entry: ManifestEntry;
  target: string;
  expectedOwner: string;
}

function manifestDocumentRoutes(
  docsRoot: string,
  entries: Record<string, ManifestEntry>,
): DocumentRoute[] {
  const root = resolve(docsRoot);
  return Object.entries(entries).flatMap(([id, entry]) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return [];
    if (typeof entry.path !== 'string' || entry.path.trim() === '') return [];
    const target = resolve(root, entry.path);
    if (target === root || !target.startsWith(`${root}${sep}`)) return [];
    return [{ id, entry, target, expectedOwner: String(entry.owner ?? id) }];
  });
}

function duplicateRouteTargets(routes: DocumentRoute[], root: string): string[] {
  const targets = new Map<string, string[]>();
  for (const { id, target } of routes) {
    targets.set(target, [...(targets.get(target) ?? []), id]);
  }
  return [...targets.entries()]
    .filter(([, owners]) => owners.length > 1)
    .map(
      ([target, owners]) =>
        `docs target ${relative(root, target)} has multiple route owners: ${owners.join(', ')}`,
    );
}

function frontmatterRouteIssues(route: DocumentRoute, routeIds: Set<string>): string[] {
  if (!existsSync(route.target)) return [];
  let frontmatter: ReturnType<typeof parseFrontmatterDocument>;
  try {
    frontmatter = parseFrontmatterDocument(readFileSync(route.target, 'utf8'));
  } catch {
    return [];
  }
  const issues: string[] = [];
  const owner = frontmatter.metadata.get('owner');
  if (typeof owner !== 'string' || owner.trim() === '') {
    issues.push(`docs route ${route.id} is missing frontmatter owner`);
  } else if (!routeIds.has(owner)) {
    issues.push(`docs route ${route.id} references unknown owner: ${owner}`);
  }
  if (owner !== route.expectedOwner) {
    issues.push(
      `docs route ${route.id} owner must be ${route.expectedOwner}, got ${String(owner)}`,
    );
  }
  const load = route.entry.load ?? 'supporting';
  const type = frontmatter.metadata.get('type');
  if (load === 'reference' && type !== 'harness-reference') {
    issues.push(`docs route ${route.id} must use harness-reference frontmatter type`);
  }
  if (load !== 'reference' && type === 'harness-reference') {
    issues.push(`docs route ${route.id} uses harness-reference without load: reference`);
  }
  return issues;
}
export function documentRouteOwnershipIssues(docsRoot: string, manifest: unknown): string[] {
  const entries = manifestEntries(manifest);
  if (!entries) return [];
  const root = resolve(docsRoot);
  const routes = manifestDocumentRoutes(docsRoot, entries);
  const routeIds = new Set(Object.keys(entries));
  return [
    ...duplicateRouteTargets(routes, root),
    ...routes.flatMap((route) => frontmatterRouteIssues(route, routeIds)),
  ];
}

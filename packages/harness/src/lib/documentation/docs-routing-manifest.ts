import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { parse } from 'yaml';
import { isPathInside } from '../filesystem/safe-path.js';
import { normalizeRoutingText } from './docs-routing-matching.js';
import type {
  DocumentationLoad,
  DocumentationManifest,
  DocumentationManifestEntry,
  DocumentationRouteKind,
  PreparedManifestEntry,
  ReasoningModeActivationRule,
} from './docs-routing-types.js';

const routeKinds = new Set<DocumentationRouteKind>(['playbook', 'topic', 'standard']);
const routeLoads = new Set<DocumentationLoad>(['supporting', 'reference']);

function manifestEntries(value: unknown): Record<string, DocumentationManifestEntry> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Documentation manifest entries must be an object');
  }
  return value as Record<string, DocumentationManifestEntry>;
}

export function loadDocumentationManifest(docsRoot: string): {
  manifest: DocumentationManifest;
  entries: Record<string, DocumentationManifestEntry>;
} {
  const manifest = parse(
    readFileSync(resolve(docsRoot, 'manifest.yaml'), 'utf8'),
  ) as DocumentationManifest;
  if (manifest?.version !== undefined && manifest.version !== 1) {
    throw new Error('Documentation manifest version must be 1');
  }
  return { manifest, entries: manifestEntries(manifest?.entries) };
}

function routePath(docsRoot: string, path: string): string {
  const root = resolve(docsRoot);
  const target = resolve(root, path);
  if (target === root || !isPathInside(root, target)) {
    throw new Error(`Documentation route escapes docs root: ${path}`);
  }
  return target;
}

function aliasesFor(
  entry: DocumentationManifestEntry,
  kind: DocumentationRouteKind,
  name: string,
): { field: string; values: unknown } {
  const canonical = kind === 'playbook' ? entry.actionAliases : entry.conceptAliases;
  if (canonical !== undefined) {
    return {
      field: kind === 'playbook' ? 'actionAliases' : 'conceptAliases',
      values: canonical,
    };
  }
  if (entry.triggers !== undefined) return { field: 'triggers', values: entry.triggers };
  throw new Error(
    `Documentation manifest entry ${name} has invalid ${kind === 'playbook' ? 'actionAliases' : 'conceptAliases'}`,
  );
}

function validStringList(values: unknown, field: string, name: string): string[] {
  if (
    !Array.isArray(values) ||
    values.length === 0 ||
    values.some((value) => typeof value !== 'string' || value.trim() === '')
  ) {
    throw new Error(`Documentation manifest entry ${name} has invalid ${field}`);
  }
  const aliases = values as string[];
  const normalized = aliases.map(normalizeRoutingText);
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`Documentation manifest entry ${name} has duplicate ${field}`);
  }
  return aliases;
}

function requiredAliases(
  entry: DocumentationManifestEntry,
  kind: DocumentationRouteKind,
  aliases: string[],
  name: string,
): string[] {
  const values = entry.requiredConceptAliases;
  if (values === undefined) return [];
  if (kind === 'playbook') {
    throw new Error(`Documentation manifest entry ${name} has invalid requiredConceptAliases`);
  }
  const required = validStringList(values, 'requiredConceptAliases', name);
  const normalizedAliases = new Set(aliases.map(normalizeRoutingText));
  if (required.some((alias) => !normalizedAliases.has(normalizeRoutingText(alias)))) {
    throw new Error(
      `Documentation manifest entry ${name} has requiredConceptAliases not present in conceptAliases`,
    );
  }
  return required;
}

function activationRules(
  entry: DocumentationManifestEntry,
  name: string,
): ReasoningModeActivationRule[] {
  if (entry.activationRules === undefined) return [];
  if (!Array.isArray(entry.activationRules) || entry.activationRules.length === 0) {
    throw new Error(`Documentation manifest entry ${name} has invalid activationRules`);
  }
  const modes = new Set<string>();
  return entry.activationRules.map((value, index) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error(`Documentation manifest entry ${name} has invalid activationRules[${index}]`);
    }
    const rule = value as Record<string, unknown>;
    if (typeof rule.mode !== 'string' || rule.mode.trim() === '' || modes.has(rule.mode)) {
      throw new Error(`Documentation manifest entry ${name} has invalid activationRules mode`);
    }
    modes.add(rule.mode);
    const aliases = validStringList(rule.aliases, `activationRules.${rule.mode}.aliases`, name);
    const signals = validStringList(rule.signals, `activationRules.${rule.mode}.signals`, name);
    if (typeof rule.section !== 'string' || rule.section.trim() === '') {
      throw new Error(`Documentation manifest entry ${name} has invalid activationRules section`);
    }
    const requiredArtifacts = validStringList(
      rule.requiredArtifacts,
      `activationRules.${rule.mode}.requiredArtifacts`,
      name,
    );
    if (
      typeof rule.minSignals !== 'number' ||
      !Number.isInteger(rule.minSignals) ||
      rule.minSignals < 1 ||
      rule.minSignals > signals.length
    ) {
      throw new Error(
        `Documentation manifest entry ${name} has invalid activationRules minSignals`,
      );
    }
    return {
      mode: rule.mode,
      aliases,
      signals,
      minSignals: rule.minSignals,
      section: rule.section,
      requiredArtifacts,
    };
  });
}

export function prepareManifestEntry(
  docsRoot: string,
  entries: Record<string, DocumentationManifestEntry>,
  name: string,
  rawEntry: DocumentationManifestEntry,
): PreparedManifestEntry {
  if (!rawEntry || typeof rawEntry !== 'object' || Array.isArray(rawEntry)) {
    throw new Error(`Documentation manifest entry ${name} must be an object`);
  }
  if (typeof rawEntry.path !== 'string' || rawEntry.path.trim() === '') {
    throw new Error(`Documentation manifest entry ${name} has no valid path`);
  }
  if (
    typeof rawEntry.kind !== 'string' ||
    !routeKinds.has(rawEntry.kind as DocumentationRouteKind)
  ) {
    throw new Error(`Documentation manifest entry ${name} has no valid kind`);
  }
  const kind = rawEntry.kind as DocumentationRouteKind;
  if (
    rawEntry.priority !== undefined &&
    (typeof rawEntry.priority !== 'number' || !Number.isInteger(rawEntry.priority))
  ) {
    throw new Error(`Documentation manifest entry ${name} has invalid priority`);
  }
  const load = (rawEntry.load ?? 'supporting') as DocumentationLoad;
  if (!routeLoads.has(load)) {
    throw new Error(`Documentation manifest entry ${name} has invalid load`);
  }
  if (kind === 'playbook' && load === 'reference') {
    throw new Error(`Documentation manifest entry ${name} cannot defer a playbook`);
  }
  const aliasData = aliasesFor(rawEntry, kind, name);
  const aliases = validStringList(aliasData.values, aliasData.field, name);
  const required = requiredAliases(rawEntry, kind, aliases, name);
  const rules = activationRules(rawEntry, name);
  if (rules.length > 0 && (kind !== 'topic' || load !== 'reference')) {
    throw new Error(
      `Documentation manifest entry ${name} activationRules require a deferred topic reference`,
    );
  }
  if (load === 'reference' && required.length > 0) {
    throw new Error(`Documentation manifest entry ${name} cannot require a deferred reference`);
  }
  if (rawEntry.owner !== undefined) {
    if (typeof rawEntry.owner !== 'string' || rawEntry.owner.trim() === '') {
      throw new Error(`Documentation manifest entry ${name} has invalid owner`);
    }
    if (!Object.hasOwn(entries, rawEntry.owner)) {
      throw new Error(`Documentation manifest entry ${name} has unknown owner`);
    }
  }
  if (load === 'reference' && rawEntry.owner === undefined) {
    throw new Error(`Documentation manifest entry ${name} has no owner for deferred reference`);
  }
  return {
    activationRules: rules,
    name,
    kind,
    load,
    path: routePath(docsRoot, rawEntry.path),
    priority: rawEntry.priority ?? 0,
    aliases,
    requiredAliases: required,
  };
}

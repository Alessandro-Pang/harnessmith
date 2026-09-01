import { createHash } from 'node:crypto';
import { containsAdoptSecret } from './adopt-secret.js';
import { HarnessmithError } from './types.js';

export const portableConfigPaths = [
  'AGENTS.md',
  'projects/repository-map.md',
  'projects/repository-map.yaml',
] as const;

export const portableConfigExcludedCategories = [
  'managed-distribution',
  'mutable-state',
  'global-memory',
  'project-memory',
  'host-credentials',
  'cache-and-temporary-files',
  'workspace-content',
] as const;

export interface PortableConfigResource {
  path: (typeof portableConfigPaths)[number];
  encoding: 'utf8';
  digest: string;
  content: string;
}

export interface PortableConfigExclusion {
  path: (typeof portableConfigPaths)[number];
  reasonCode: 'SECRET_DETECTED' | 'FILE_BUDGET_EXCEEDED';
}

export interface PortableConfigBundle {
  schemaVersion: 1;
  kind: 'harnessmith-portable-config';
  rootKind: 'personal-overlay';
  collectionResult: 'complete' | 'partial';
  resources: PortableConfigResource[];
  exclusions: PortableConfigExclusion[];
  excludedCategories: typeof portableConfigExcludedCategories;
  bundleDigest: string;
}

const digestPattern = /^sha256:[a-f0-9]{64}$/;

export function portableDigest(value: string): string {
  return `sha256:${createHash('sha256').update(value).digest('hex')}`;
}

export function portableBundleDigest(bundle: Omit<PortableConfigBundle, 'bundleDigest'>): string {
  return portableDigest(JSON.stringify(bundle));
}

function integrity(message: string): never {
  throw new HarnessmithError('INTEGRITY_ERROR', message, 3);
}

function object(value: unknown, name: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return integrity(`Invalid portable config ${name}`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(value: Record<string, unknown>, expected: string[], name: string): void {
  const actual = Object.keys(value).sort();
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) {
    integrity(`Invalid portable config ${name} fields`);
  }
}

function parseResource(value: unknown): PortableConfigResource {
  const item = object(value, 'resource');
  exactKeys(item, ['content', 'digest', 'encoding', 'path'], 'resource');
  if (!portableConfigPaths.includes(item.path as PortableConfigResource['path'])) {
    integrity('Invalid portable config resource path');
  }
  if (item.encoding !== 'utf8' || typeof item.content !== 'string') {
    integrity('Invalid portable config resource encoding');
  }
  if (Buffer.byteLength(item.content, 'utf8') > 256 * 1024) {
    integrity('Portable config resource exceeds byte budget');
  }
  if (containsAdoptSecret(item.content)) integrity('Portable config resource contains a secret');
  if (typeof item.digest !== 'string' || !digestPattern.test(item.digest)) {
    integrity('Invalid portable config resource digest');
  }
  if (portableDigest(item.content) !== item.digest)
    integrity('Portable config resource digest mismatch');
  return item as unknown as PortableConfigResource;
}

function parseExclusion(value: unknown): PortableConfigExclusion {
  const item = object(value, 'exclusion');
  exactKeys(item, ['path', 'reasonCode'], 'exclusion');
  if (!portableConfigPaths.includes(item.path as PortableConfigExclusion['path'])) {
    integrity('Invalid portable config exclusion path');
  }
  if (!['SECRET_DETECTED', 'FILE_BUDGET_EXCEEDED'].includes(String(item.reasonCode))) {
    integrity('Invalid portable config exclusion reason');
  }
  return item as unknown as PortableConfigExclusion;
}

export function parsePortableConfigBundle(value: unknown): PortableConfigBundle {
  const bundle = object(value, 'bundle');
  exactKeys(
    bundle,
    [
      'bundleDigest',
      'collectionResult',
      'excludedCategories',
      'exclusions',
      'kind',
      'resources',
      'rootKind',
      'schemaVersion',
    ],
    'bundle',
  );
  if (bundle.schemaVersion !== 1) integrity('Unsupported portable config schema version');
  if (bundle.kind !== 'harnessmith-portable-config' || bundle.rootKind !== 'personal-overlay') {
    integrity('Invalid portable config kind');
  }
  if (!Array.isArray(bundle.resources) || !Array.isArray(bundle.exclusions)) {
    integrity('Invalid portable config resource lists');
  }
  const resources = bundle.resources.map(parseResource);
  const exclusions = bundle.exclusions.map(parseExclusion);
  const resourcePaths = resources.map(({ path }) => path);
  const exclusionPaths = exclusions.map(({ path }) => path);
  if (
    new Set([...resourcePaths, ...exclusionPaths]).size !==
    resources.length + exclusions.length
  ) {
    integrity('Duplicate portable config resource path');
  }
  if (
    !Array.isArray(bundle.excludedCategories) ||
    JSON.stringify(bundle.excludedCategories) !== JSON.stringify(portableConfigExcludedCategories)
  ) {
    integrity('Invalid portable config excluded categories');
  }
  const expectedResult = exclusions.length > 0 ? 'partial' : 'complete';
  if (bundle.collectionResult !== expectedResult) integrity('Invalid portable config result');
  if (typeof bundle.bundleDigest !== 'string' || !digestPattern.test(bundle.bundleDigest)) {
    integrity('Invalid portable config bundle digest');
  }
  const normalized = {
    schemaVersion: 1,
    kind: 'harnessmith-portable-config',
    rootKind: 'personal-overlay',
    collectionResult: expectedResult,
    resources,
    exclusions,
    excludedCategories: portableConfigExcludedCategories,
  } as const;
  if (portableBundleDigest(normalized) !== bundle.bundleDigest) {
    integrity('Portable config bundle digest mismatch');
  }
  return { ...normalized, bundleDigest: bundle.bundleDigest };
}

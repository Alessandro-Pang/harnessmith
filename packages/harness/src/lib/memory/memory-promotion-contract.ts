import { findingListSection } from './memory-finding.js';

export type PromotionArtifactType = 'adr' | 'docs' | 'tests' | 'schema' | 'lint' | 'ci';

export interface MemoryPromotionOptions {
  target: string;
  artifactType: PromotionArtifactType;
  owner: string;
  reason: string;
  verifier: string;
  adoptionEvidence?: string[];
}

export interface MemoryPromotionProposal {
  version: 2;
  schema: 'urn:agent-harness:schema:memory-promotion:v2';
  mode: 'proposal-only';
  memory: string;
  source: {
    kind: string;
    status: string;
    updated: string | null;
    freshness: 'current' | 'stale' | 'unknown';
    owners: string[];
  };
  target: {
    path: string;
    reference: string;
    artifactType: PromotionArtifactType;
    owner: string;
    exists: boolean;
    dirty: boolean | null;
  };
  title: string;
  description: string;
  reason: string;
  evidence: { items: string[]; sourceRefs: string[] };
  verification: { command: string; status: 'required' };
  authorization: { formalWrite: 'not-authorized-by-proposal' };
  unmetConditions: string[];
  supersedeCandidate: {
    status: 'candidate';
    memory: string;
    authoritativeTarget: string;
    evidence: string[];
    requiredLifecycle: 'owner-confirmed-typed-supersede';
  } | null;
  sourceOfTruth: false;
}

export function boundedPromotionValue(value: string, label: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 500 || /\r|\n/.test(normalized)) {
    throw new Error(`Memory promotion ${label} must be a bounded single line`);
  }
  return normalized;
}

export function assertPromotionTargetType(type: PromotionArtifactType, reference: string): void {
  const path = reference.toLowerCase();
  const matches =
    (type === 'adr' && /^(?:docs\/)?adrs?\/.+\.md$/u.test(path)) ||
    (type === 'docs' && /^docs\/.+\.md$/u.test(path)) ||
    (type === 'tests' &&
      /(?:^|\/)__tests__\/.+\.[cm]?[jt]sx?$|\.(?:test|spec)\.[cm]?[jt]sx?$/u.test(path)) ||
    (type === 'schema' && /(?:^|\/)schemas?\/.+|\.schema\.(?:json|ya?ml)$/u.test(path)) ||
    (type === 'lint' &&
      /(?:^|\/)(?:biome|eslint|markdownlint|secretlint|lint)[^/]*|(?:^|\/)scripts\/[^/]*lint/u.test(
        path,
      )) ||
    (type === 'ci' && /^\.github\/workflows\/.+\.ya?ml$/u.test(path));
  if (!matches) {
    throw new Error(`Promotion artifact type ${type} does not match target: ${reference}`);
  }
}

function sourceFreshness(metadata: Map<string, unknown>): 'current' | 'stale' | 'unknown' {
  const status = metadata.get('status');
  if (status === 'superseded' || status === 'archived') return 'stale';
  const updated = metadata.get('updated');
  if (
    ['active', 'blocked', 'complete'].includes(String(status)) &&
    typeof updated === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/u.test(updated)
  ) {
    return 'current';
  }
  return 'unknown';
}

export function promotionSource(metadata: Map<string, unknown>, body: string) {
  const stringList = (field: string) =>
    Array.isArray(metadata.get(field))
      ? (metadata.get(field) as unknown[]).filter(
          (value): value is string => typeof value === 'string' && value.trim().length > 0,
        )
      : [];
  return {
    title: String(metadata.get('title') || 'untitled'),
    description: String(metadata.get('description') || ''),
    sourceRefs: stringList('source-refs'),
    evidenceItems: [
      ...new Set([...findingListSection(body, '证据'), ...findingListSection(body, 'Evidence')]),
    ],
    source: {
      kind: String(metadata.get('type') || 'unknown'),
      status: String(metadata.get('status') || 'unknown'),
      updated: typeof metadata.get('updated') === 'string' ? String(metadata.get('updated')) : null,
      freshness: sourceFreshness(metadata),
      owners: stringList('owners'),
    },
  };
}

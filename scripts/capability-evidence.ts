import { existsSync } from 'node:fs';
import { resolve, sep } from 'node:path';

interface CapabilityClaim {
  id?: unknown;
  status?: unknown;
  owner?: unknown;
  claim?: unknown;
  implementation?: unknown;
  verification?: unknown;
  boundary?: unknown;
}

interface CapabilityEvidence {
  version?: unknown;
  positioning?: unknown;
  claims?: unknown;
}

const CAPABILITY_STATES = ['implemented', 'delegated', 'unsupported'] as const;
const CANONICAL_POSITIONING =
  'cross-host Personal Harness distribution and work-state control plane';

function evidencePaths(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((path): path is string => typeof path === 'string' && path.length > 0)
    : [];
}

function claimEvidenceIssues(root: string, claim: CapabilityClaim, index: number): string[] {
  const issues: string[] = [];
  const id = typeof claim.id === 'string' && claim.id.length > 0 ? claim.id : `#${index + 1}`;
  if (typeof claim.id !== 'string' || claim.id.length === 0)
    issues.push(`capability claim ${id} has no id`);
  if (!CAPABILITY_STATES.includes(claim.status as (typeof CAPABILITY_STATES)[number]))
    issues.push(`capability claim ${id} has invalid status`);
  if (typeof claim.owner !== 'string' || claim.owner.length === 0)
    issues.push(`capability claim ${id} has no owner`);
  if (typeof claim.claim !== 'string' || claim.claim.length === 0)
    issues.push(`capability claim ${id} has no public claim`);

  const groups = [
    ['implementation', evidencePaths(claim.implementation)],
    ['verification', evidencePaths(claim.verification)],
    ['boundary', evidencePaths(claim.boundary)],
  ] as const;
  if (claim.status === 'implemented') {
    if (groups[0][1].length === 0)
      issues.push(`implemented claim ${id} has no implementation evidence`);
    if (groups[1][1].length === 0)
      issues.push(`implemented claim ${id} has no verification evidence`);
  } else if (groups[2][1].length === 0) {
    issues.push(`claim ${id} has no boundary evidence`);
  }

  for (const [kind, paths] of groups) {
    for (const path of paths) {
      const target = resolve(root, path);
      if (!target.startsWith(`${resolve(root)}${sep}`) || !existsSync(target))
        issues.push(`claim ${id} references missing ${kind} evidence: ${path}`);
    }
  }
  return issues;
}

export function capabilityEvidenceIssues(root: string, evidence: unknown): string[] {
  const document =
    evidence && typeof evidence === 'object' && !Array.isArray(evidence)
      ? (evidence as CapabilityEvidence)
      : {};
  const claims = Array.isArray(document.claims)
    ? document.claims.filter(
        (claim): claim is CapabilityClaim =>
          Boolean(claim) && typeof claim === 'object' && !Array.isArray(claim),
      )
    : [];
  const issues: string[] = [];

  if (document.version !== 1) issues.push('capability evidence version must be 1');
  if (document.positioning !== CANONICAL_POSITIONING)
    issues.push('capability evidence positioning is not canonical');
  for (const status of CAPABILITY_STATES) {
    if (!claims.some((claim) => claim.status === status))
      issues.push(`capability evidence is missing status: ${status}`);
  }
  for (const [index, claim] of claims.entries()) {
    issues.push(...claimEvidenceIssues(root, claim, index));
  }
  return issues;
}

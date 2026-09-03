import { existsSync } from 'node:fs';
import { dirname, relative, resolve, sep } from 'node:path';
import { parseFrontmatterDocument } from '../../lib/documentation/frontmatter.js';
import { assertSafePath, sameCanonicalPath } from '../../lib/filesystem/safe-path.js';
import {
  isInside,
  memoryDocumentPath,
  memoryReference,
  readMemoryDocument,
  resolveMemoryRoot,
} from '../../lib/memory/memory-path.js';
import { validateMemoryPreflight } from '../../lib/memory/memory-preflight.js';
import {
  assertPromotionTargetType,
  boundedPromotionValue,
  type MemoryPromotionOptions,
  type MemoryPromotionProposal,
  promotionSource,
} from '../../lib/memory/memory-promotion-contract.js';
import { resolveProjectRoot } from '../../lib/project/project.js';
import { createProjectGitBudget, projectGit } from '../../lib/project/project-git.js';
import { assertNoHighConfidenceSecret } from '../../lib/security/secret-hygiene.js';
import type { Io, Runtime } from '../../types.js';

export type {
  MemoryPromotionOptions,
  MemoryPromotionProposal,
} from '../../lib/memory/memory-promotion-contract.js';

function targetDirty(project: string, reference: string): boolean | null {
  const status = projectGit(
    project,
    ['status', '--porcelain=v1', '--untracked-files=all', '--', reference],
    createProjectGitBudget({}),
  );
  return status === null ? null : status.length > 0;
}

function promotionPaths(
  runtime: Runtime,
  input: string,
  name: string,
  options: MemoryPromotionOptions,
) {
  if (input === 'global') throw new Error('Promotion requires a project memory scope');
  const project = resolveProjectRoot(input);
  assertSafePath(project, project);
  const root = resolveMemoryRoot(runtime, project);
  if (sameCanonicalPath(root, runtime.memoryHome)) {
    throw new Error('Promotion requires a project memory scope');
  }
  if (dirname(root) !== project || !isInside(project, root)) {
    throw new Error(`Promotion memory root must belong to the project: ${root}`);
  }
  assertSafePath(project, root);
  const source = memoryDocumentPath(root, name);
  const target = resolve(project, options.target);
  if (target === project || !isInside(project, target) || isInside(root, target)) {
    throw new Error(
      `Promotion target must be an authoritative project path outside .agent-docs: ${target}`,
    );
  }
  assertSafePath(project, target);
  const targetReference = relative(project, target).split(sep).join('/');
  assertPromotionTargetType(options.artifactType, targetReference);
  return { project, root, source, target, targetReference };
}

function readPromotionSource(root: string, source: string) {
  validateMemoryPreflight(root, 'project');
  const sourceContent = readMemoryDocument(source);
  assertNoHighConfidenceSecret([sourceContent], 'Memory promotion source');
  let parsed: ReturnType<typeof parseFrontmatterDocument>;
  try {
    parsed = parseFrontmatterDocument(sourceContent);
  } catch {
    throw new Error('Invalid memory promotion source frontmatter');
  }
  if (!parsed.found) throw new Error('Invalid memory promotion source frontmatter');
  return promotionSource(parsed.metadata, parsed.body);
}

export function memoryPromotionProposal(
  runtime: Runtime,
  input: string,
  name: string,
  options: MemoryPromotionOptions,
  io: Io = console,
): MemoryPromotionProposal {
  const owner = boundedPromotionValue(options.owner, 'owner');
  const reason = boundedPromotionValue(options.reason, 'reason');
  const verifier = boundedPromotionValue(options.verifier, 'verifier');
  const adoptionEvidence = (options.adoptionEvidence ?? []).map((item) =>
    boundedPromotionValue(item, 'adoption evidence'),
  );
  assertNoHighConfidenceSecret(
    [
      input,
      name,
      options.target,
      options.artifactType,
      owner,
      reason,
      verifier,
      ...adoptionEvidence,
    ],
    'Memory promotion request',
  );
  const { project, root, source, target, targetReference } = promotionPaths(
    runtime,
    input,
    name,
    options,
  );
  const {
    title,
    description,
    sourceRefs,
    evidenceItems,
    source: sourceReport,
  } = readPromotionSource(root, source);
  assertNoHighConfidenceSecret(
    [title, description, ...sourceRefs, ...evidenceItems],
    'Memory promotion proposal',
  );
  const memory = memoryReference(root, source);
  const dirty = targetDirty(project, targetReference);
  const unmetConditions = ['formal-write-authorization-required'];
  if (dirty === true) unmetConditions.push('target-dirty');
  else if (dirty === null) unmetConditions.push('target-dirty-unknown');
  if (sourceReport.freshness === 'stale') unmetConditions.push('source-stale');
  else if (sourceReport.freshness === 'unknown') unmetConditions.push('source-freshness-unknown');
  if (sourceRefs.length === 0 && evidenceItems.length === 0) {
    unmetConditions.push('source-evidence-required');
  }
  if (sourceReport.owners.length === 0) unmetConditions.push('source-owner-required');
  const proposal: MemoryPromotionProposal = {
    version: 2,
    schema: 'urn:agent-harness:schema:memory-promotion:v2',
    mode: 'proposal-only',
    memory,
    source: sourceReport,
    target: {
      path: target,
      reference: targetReference,
      artifactType: options.artifactType,
      owner,
      exists: existsSync(target),
      dirty,
    },
    title,
    description,
    reason,
    evidence: { items: evidenceItems, sourceRefs },
    verification: { command: verifier, status: 'required' },
    authorization: { formalWrite: 'not-authorized-by-proposal' },
    unmetConditions,
    supersedeCandidate:
      existsSync(target) && adoptionEvidence.length > 0
        ? {
            status: 'candidate',
            memory: `memory:${memory}`,
            authoritativeTarget: targetReference,
            evidence: adoptionEvidence,
            requiredLifecycle: 'owner-confirmed-typed-supersede',
          }
        : null,
    sourceOfTruth: false,
  };
  io.log(JSON.stringify(proposal, null, 2));
  return proposal;
}

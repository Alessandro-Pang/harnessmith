import { dirname, resolve } from 'node:path';
import { parseFrontmatter } from '../lib/frontmatter.js';
import {
  isInside,
  memoryDocumentPath,
  memoryReference,
  readMemoryDocument,
  resolveMemoryRoot,
} from '../lib/memory-path.js';
import { validateMemoryPreflight } from '../lib/memory-preflight.js';
import { resolveProjectRoot } from '../lib/project.js';
import { assertSafePath, sameCanonicalPath } from '../lib/safe-path.js';
import { assertNoHighConfidenceSecret } from '../lib/secret-hygiene.js';
import type { Io, Runtime } from '../types.js';

export interface MemoryPromotionProposal {
  version: 1;
  mode: 'proposal-only';
  memory: string;
  target: string;
  title: string;
  description: string;
  sourceRefs: string[];
  sourceOfTruth: false;
}

export function memoryPromotionProposal(
  runtime: Runtime,
  input: string,
  name: string,
  targetName: string,
  io: Io = console,
): MemoryPromotionProposal {
  assertNoHighConfidenceSecret([input, name, targetName], 'Memory promotion request');
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
  const target = resolve(project, targetName);
  if (target === project || !isInside(project, target) || isInside(root, target)) {
    throw new Error(
      `Promotion target must be an authoritative project path outside .agent-docs: ${target}`,
    );
  }
  assertSafePath(project, target);
  validateMemoryPreflight(root, 'project');
  const sourceContent = readMemoryDocument(source);
  assertNoHighConfidenceSecret([sourceContent], 'Memory promotion source');
  let metadata: Map<string, unknown>;
  try {
    metadata = parseFrontmatter(sourceContent);
  } catch {
    throw new Error('Invalid memory promotion source frontmatter');
  }
  const title = String(metadata.get('title') || 'untitled');
  const description = String(metadata.get('description') || '');
  const sourceRefs = Array.isArray(metadata.get('source-refs'))
    ? (metadata.get('source-refs') as unknown[]).filter(
        (value): value is string => typeof value === 'string',
      )
    : [];
  assertNoHighConfidenceSecret([title, description, ...sourceRefs], 'Memory promotion proposal');
  const proposal: MemoryPromotionProposal = {
    version: 1,
    mode: 'proposal-only',
    memory: memoryReference(root, source),
    target,
    title,
    description,
    sourceRefs,
    sourceOfTruth: false,
  };
  io.log(JSON.stringify(proposal, null, 2));
  return proposal;
}

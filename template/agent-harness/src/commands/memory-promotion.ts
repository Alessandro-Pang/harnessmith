import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { parseFrontmatter } from '../lib/frontmatter.js';
import {
  isInside,
  memoryDocumentPath,
  memoryReference,
  resolveMemoryRoot,
} from '../lib/memory-path.js';
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
  if (input === 'global') throw new Error('Promotion requires a project memory scope');
  const root = resolveMemoryRoot(runtime, input);
  const project = dirname(root);
  const source = memoryDocumentPath(root, name);
  const target = resolve(project, targetName);
  if (target === project || !isInside(project, target) || isInside(root, target)) {
    throw new Error(
      `Promotion target must be an authoritative project path outside .agent-docs: ${target}`,
    );
  }
  const metadata = parseFrontmatter(readFileSync(source, 'utf8'));
  const proposal: MemoryPromotionProposal = {
    version: 1,
    mode: 'proposal-only',
    memory: memoryReference(root, source),
    target,
    title: String(metadata.get('title') || 'untitled'),
    description: String(metadata.get('description') || ''),
    sourceRefs: Array.isArray(metadata.get('source-refs'))
      ? (metadata.get('source-refs') as unknown[]).filter(
          (value): value is string => typeof value === 'string',
        )
      : [],
    sourceOfTruth: false,
  };
  io.log(JSON.stringify(proposal, null, 2));
  return proposal;
}

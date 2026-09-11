import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { harnessSkillName } from '../installation/hub.js';
import { canonicalPath, isPathInside } from '../shared/safe-path.js';
import type { Adapter, Hub, IgnoreFile, Instruction, ManagedOutput } from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';
import { type AgentName, getAdapterDefinition } from './adapter-registry.js';
import { type GitInspection, inspectGit } from './git-inspection.js';

export interface AdapterResolveContext {
  env: NodeJS.ProcessEnv;
  project: string;
  userHome: string;
  hub: Hub;
}

export type AdapterResolver = (context: AdapterResolveContext) => Adapter;

function gitInspectionError(action: string, result: Exclude<GitInspection, { ok: true }>): never {
  throw new HarnessmithError('INTEGRITY_ERROR', `Unable to ${action}: ${result.message}`, 3);
}

export function projectRoot(input: string): string {
  const requested = resolve(input);
  if (!existsSync(requested))
    throw new HarnessmithError('CLI_USAGE', `Project path does not exist: ${requested}`, 2);
  if (!statSync(requested).isDirectory())
    throw new HarnessmithError('CLI_USAGE', `Project path is not a directory: ${requested}`, 2);
  const canonicalRequested = canonicalPath(requested);
  const inspection = inspectGit(canonicalRequested, ['rev-parse', '--show-toplevel']);
  if (inspection.ok) {
    const root = canonicalPath(inspection.stdout.trim());
    if (!isPathInside(root, canonicalRequested)) {
      throw new HarnessmithError(
        'INTEGRITY_ERROR',
        `Git root is outside the requested project boundary: ${root}`,
        3,
      );
    }
    return root;
  }
  if (inspection.kind === 'not-repository') return canonicalRequested;
  return gitInspectionError('resolve the project Git root', inspection);
}

/**
 * Hosts never receive a Harness copy. Every always-on instruction file is a symlink to the
 * shared hub entry, and hosts that do not scan `~/.agents/skills` additionally get a
 * `<home>/skills/agent-harness` symlink to the hub skill so it appears in their catalog.
 */
export function hostAdapter(
  name: AgentName,
  home: string,
  hub: Hub,
  {
    instructionFiles = ['AGENTS.md'],
    skillLink = false,
    project,
    renderInstructions = [],
    localIgnoreFiles,
  }: {
    instructionFiles?: string[];
    skillLink?: boolean;
    project?: string;
    renderInstructions?: Array<{ path: string; render: (content: string) => string }>;
    localIgnoreFiles?: IgnoreFile[];
  } = {},
): Adapter {
  const definition = getAdapterDefinition(name);
  const harness = skillLink ? join(home, 'skills', harnessSkillName) : null;
  const instructions: Instruction[] = [
    ...instructionFiles.map((file): Instruction => ({ path: join(home, file), mode: 'link' })),
    ...renderInstructions.map(
      ({ path, render }): Instruction => ({ path, mode: 'render', render }),
    ),
  ];
  const outputs: ManagedOutput[] = [
    ...(harness ? [{ path: harness, kind: 'link' as const, target: hub.harness }] : []),
    ...instructions.map(
      (instruction): ManagedOutput =>
        instruction.mode === 'link'
          ? { path: instruction.path, kind: 'link', target: hub.entry }
          : { path: instruction.path, kind: 'file' },
    ),
  ];
  return {
    scope: 'adapter',
    name,
    label: definition.label,
    home,
    hub,
    harness,
    legacyHarness: join(home, harnessSkillName),
    record: join(home, '.harnessmith', 'install.json'),
    outputs,
    capabilities: definition.capabilities,
    ...(project ? { project } : {}),
    instructions,
    ...(localIgnoreFiles ? { localIgnoreFiles } : {}),
  };
}

export function gitExcludePath(root: string): { path: string; root: string } | null {
  const commonInspection = inspectGit(root, ['rev-parse', '--git-common-dir']);
  if (!commonInspection.ok) {
    if (commonInspection.kind === 'not-repository') return null;
    return gitInspectionError('resolve the Git common directory', commonInspection);
  }
  const commonRoot = canonicalPath(resolve(root, commonInspection.stdout.trim()));
  const pathInspection = inspectGit(root, ['rev-parse', '--git-path', 'info/exclude']);
  if (!pathInspection.ok) {
    if (pathInspection.kind === 'not-repository') return null;
    return gitInspectionError('resolve the Git exclude path', pathInspection);
  }
  const path = canonicalPath(resolve(root, pathInspection.stdout.trim()));
  const expected = canonicalPath(join(commonRoot, 'info', 'exclude'));
  if (!isPathInside(commonRoot, path) || path !== expected) {
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `Git exclude path is outside the Git common directory: ${path}`,
      3,
    );
  }
  return { path, root: commonRoot };
}

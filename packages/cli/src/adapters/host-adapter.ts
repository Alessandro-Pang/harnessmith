import { existsSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { canonicalPath, isPathInside } from '../shared/safe-path.js';
import type {
  Adapter,
  IgnoreFile,
  Instruction,
  ManagedOutput,
  UserDataPaths,
} from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';
import { type AgentName, getAdapterDefinition } from './adapter-registry.js';
import { type GitInspection, inspectGit } from './git-inspection.js';
import { instructionRenderer } from './instruction-formats.js';

export interface AdapterResolveContext {
  env: NodeJS.ProcessEnv;
  project: string;
  userHome: string;
  userData: UserDataPaths;
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
 * Adapters own only rendered always-on instruction files. The skills CLI owns skill
 * discovery and canonical copies; no adapter receives a Runtime, script, or skill link.
 */
export function hostAdapter(
  name: AgentName,
  home: string,
  userData: UserDataPaths,
  {
    instructionFiles = ['AGENTS.md'],
    project,
    renderInstructions = [],
    localIgnoreFiles,
  }: {
    instructionFiles?: string[];
    project?: string;
    renderInstructions?: Array<{ path: string; render: (content: string) => string }>;
    localIgnoreFiles?: IgnoreFile[];
  } = {},
): Adapter {
  const definition = getAdapterDefinition(name);
  // Entry files are the shared cross-host markdown entry; host-native rule formats (e.g.
  // Cursor's .mdc) are selected through the same renderer via renderInstructions below.
  const renderEntry = instructionRenderer('markdown');
  const instructions: Instruction[] = [
    ...instructionFiles.map(
      (file): Instruction => ({
        path: join(home, file),
        render: renderEntry,
      }),
    ),
    ...renderInstructions.map(({ path, render }): Instruction => ({ path, render })),
  ];
  const outputs: ManagedOutput[] = instructions.map(
    (instruction): ManagedOutput => ({ path: instruction.path }),
  );
  return {
    scope: 'adapter',
    name,
    label: definition.label,
    home,
    userData,
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

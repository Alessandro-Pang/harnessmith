import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { atomicWrite, digestPath, removeExact } from '../shared/files.js';
import { assertSafePath, assertSafeScopePaths } from '../shared/safe-path.js';
import type {
  Adapter,
  InstallOptions,
  InstallRecord,
  PreparedInstall,
  StagedOutput,
  UserDataPaths,
} from '../shared/types.js';
import { errorMessage, HarnessmithError } from '../shared/types.js';
import { installationRenderer, templateRoot } from './install-template.js';
import {
  assertScopeContract,
  plannedOutputs,
  readInstallRecord,
  snapshotFiles,
} from './records.js';

function assertInstallable(scope: Adapter, record: InstallRecord | null, force: boolean): void {
  const conflicts = plannedOutputs(scope, record).filter(({ action }) => action === 'conflict');
  if (conflicts.length > 0 && !force) {
    throw new HarnessmithError(
      'SAFETY_CONFLICT',
      `Existing unmanaged or modified files require --force:\n${conflicts.map(({ path }) => `  ${path}`).join('\n')}`,
      3,
    );
  }
}

/** Adopt proposals pin the checksums they inspected; a change since then aborts the install. */
function assertExpectedOutputs(
  scope: Adapter,
  expected: Record<string, string | null> | undefined,
): void {
  if (!expected) return;
  for (const { path } of scope.outputs) {
    if (!(path in expected) || digestPath(path) !== expected[path]) {
      throw new HarnessmithError(
        'STATE_CONFLICT',
        `Adopt proposal changed before installation: ${path}`,
        3,
      );
    }
  }
}

function openStage(
  scope: Adapter,
  options: InstallOptions,
): { record: InstallRecord | null; stageRoot: string } {
  assertScopeContract(scope);
  assertExpectedOutputs(scope, options.expectedOutputChecksums);
  const record = readInstallRecord(scope);
  assertInstallable(scope, record, options.force ?? false);
  mkdirSync(scope.home, { recursive: true });
  assertSafeScopePaths(scope);
  const stageRoot = mkdtempSync(join(scope.home, '.harnessmith-stage-'));
  assertSafePath(scope.home, stageRoot);
  return { record, stageRoot };
}

export function renderedEntry(userData: UserDataPaths, env: NodeJS.ProcessEnv): string {
  const render = installationRenderer(userData, env);
  return render(readFileSync(join(templateRoot, 'template', 'entry', 'AGENTS.md'), 'utf8'));
}

/** True when the scope's current installation record already owns `path`. */
function managesPath(record: InstallRecord | null, path: string): boolean {
  return Boolean(record?.outputs.some((output) => output.path === path));
}

/** Stage only the host-specific always-on instruction files. */
export function prepareInstall(adapter: Adapter, options: InstallOptions = {}): PreparedInstall {
  const env = options.env ?? process.env;
  const { record, stageRoot } = openStage(adapter, options);
  try {
    const entry = renderedEntry(adapter.userData, env);
    const outputs: StagedOutput[] = adapter.outputs.map((output, index) => {
      const staged = join(stageRoot, 'outputs', String(index));
      mkdirSync(join(stageRoot, 'outputs'), { recursive: true });
      const instruction = adapter.instructions.find(({ path }) => path === output.path);
      if (!instruction) {
        throw new Error(`No renderer for host output: ${output.path}`);
      }
      atomicWrite(staged, instruction.render(entry));
      return {
        staged,
        destination: output.path,
        root: output.root || adapter.home,
        managed: managesPath(record, output.path),
      };
    });
    return {
      scope: adapter,
      stageRoot,
      outputs,
      backups: [],
      installed: [],
      recordBackup: null,
      recordWritten: false,
      ignoreWritten: 0,
      ignoreSnapshots: snapshotFiles(adapter.localIgnoreFiles || []),
    };
  } catch (error) {
    removeExact(stageRoot);
    throw new Error(`Could not stage ${adapter.label}: ${errorMessage(error)}`);
  }
}

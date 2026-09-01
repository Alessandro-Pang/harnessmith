import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import {
  atomicWrite,
  copyRenderedTree,
  removeExact,
  replaceManagedBlock,
  timestamp,
} from './files.js';
import {
  checkModules,
  installationRenderer,
  installationValues,
  isHarnessDistributionPath,
  packageVersion,
  templateRoot,
} from './install-template.js';
import { withAdapterLocks } from './operation-lock.js';
import {
  assertNonOverlappingAdapters,
  describeInstall,
  digestManagedOutput,
  managedBlockMarker,
  restoreSnapshots,
  snapshotFiles,
} from './records.js';
import { assertSafeAdapterPaths, assertSafePath, ignoreRoot } from './safe-path.js';
import type { Adapter, InstallOptions, InstallResult, PreparedInstall } from './types.js';
import { errorMessage, HarnessmithError } from './types.js';
import { initializeUserData } from './user-data.js';

function assertInstallable(adapter: Adapter, force: boolean): void {
  const conflicts = describeInstall(adapter).outputs.filter(({ action }) => action === 'conflict');
  if (conflicts.length > 0 && !force) {
    throw new HarnessmithError(
      'SAFETY_CONFLICT',
      `Existing unmanaged or modified files require --force:\n${conflicts.map(({ path }) => `  ${path}`).join('\n')}`,
      3,
    );
  }
}

function assertExpectedOutputs(
  adapter: Adapter,
  expected: Record<string, string | null> | undefined,
): void {
  if (!expected) return;
  for (const path of [adapter.harness, ...adapter.instructions.map(({ path }) => path)]) {
    if (!(path in expected) || digestManagedOutput(adapter, path) !== expected[path]) {
      throw new HarnessmithError(
        'STATE_CONFLICT',
        `Adopt proposal changed before installation: ${path}`,
        3,
      );
    }
  }
}

export function prepareInstall(adapter: Adapter, options: InstallOptions = {}): PreparedInstall {
  const { env = process.env, force = false } = options;
  assertSafeAdapterPaths(adapter);
  assertExpectedOutputs(adapter, options.expectedOutputChecksums);
  assertInstallable(adapter, force);
  mkdirSync(adapter.home, { recursive: true });
  assertSafeAdapterPaths(adapter);
  const stageRoot = mkdtempSync(join(adapter.home, '.harnessmith-stage-'));
  assertSafePath(adapter.home, stageRoot);
  try {
    const render = installationRenderer(adapter, env);
    const stagedHarness = join(stageRoot, 'agent-harness');
    copyRenderedTree(
      join(templateRoot, 'agent-harness'),
      stagedHarness,
      render,
      '',
      isHarnessDistributionPath,
    );
    atomicWrite(
      join(stagedHarness, 'install-context.json'),
      `${JSON.stringify(installationValues(adapter, env), null, 2)}\n`,
    );
    if (existsSync(join(adapter.harness, 'state'))) {
      cpSync(join(adapter.harness, 'state'), join(stagedHarness, 'state'), { recursive: true });
    }
    checkModules(stagedHarness);

    const agentsSource = render(readFileSync(join(templateRoot, 'AGENTS.md'), 'utf8'));
    const outputs = [{ staged: stagedHarness, destination: adapter.harness }];
    for (const instruction of adapter.instructions) {
      const staged = join(stageRoot, 'instructions', relative(adapter.home, instruction.path));
      atomicWrite(staged, instruction.render(agentsSource));
      outputs.push({ staged, destination: instruction.path });
    }
    return {
      adapter,
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

export function commitInstall(prepared: PreparedInstall, stamp = timestamp()): PreparedInstall {
  assertSafeAdapterPaths(prepared.adapter);
  assertSafePath(prepared.adapter.home, prepared.stageRoot);
  for (const output of prepared.outputs) {
    assertSafePath(prepared.stageRoot, output.staged);
    assertSafePath(prepared.adapter.home, output.destination);
    assertSafePath(prepared.adapter.home, `${output.destination}.backup-${stamp}`);
  }
  for (const ignore of prepared.adapter.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(prepared.adapter, ignore), ignore.path);
  }
  assertSafePath(prepared.adapter.home, prepared.adapter.record);
  assertSafePath(prepared.adapter.home, `${prepared.adapter.record}.backup-${stamp}`);
  for (const output of prepared.outputs) {
    mkdirSync(dirname(output.destination), { recursive: true });
    assertSafePath(prepared.adapter.home, output.destination);
    if (existsSync(output.destination)) {
      const backup = `${output.destination}.backup-${stamp}`;
      renameSync(output.destination, backup);
      prepared.backups.push({ original: output.destination, backup });
    }
    renameSync(output.staged, output.destination);
    prepared.installed.push(output.destination);
  }
  for (const ignore of prepared.adapter.localIgnoreFiles || []) {
    assertSafePath(ignoreRoot(prepared.adapter, ignore), ignore.path);
    replaceManagedBlock(ignore.path, managedBlockMarker, ignore.lines, ignore);
    prepared.ignoreWritten += 1;
  }
  mkdirSync(dirname(prepared.adapter.record), { recursive: true });
  assertSafePath(prepared.adapter.home, prepared.adapter.record);
  if (existsSync(prepared.adapter.record)) {
    prepared.recordBackup = `${prepared.adapter.record}.backup-${stamp}`;
    renameSync(prepared.adapter.record, prepared.recordBackup);
  }
  const record = {
    schemaVersion: 1,
    packageVersion,
    adapter: prepared.adapter.name,
    installedAt: new Date().toISOString(),
    outputs: prepared.outputs.map(({ destination }) => ({
      path: destination,
      checksum: digestManagedOutput(prepared.adapter, destination),
      backup: prepared.backups.find(({ original }) => original === destination)?.backup || null,
    })),
    ignoreFiles: (prepared.adapter.localIgnoreFiles || []).map(({ path }) => path),
    recordBackup: prepared.recordBackup,
  };
  atomicWrite(prepared.adapter.record, `${JSON.stringify(record, null, 2)}\n`);
  prepared.recordWritten = true;
  removeExact(prepared.stageRoot);
  return prepared;
}

export function rollbackInstall(prepared: PreparedInstall): void {
  if (prepared.recordWritten) {
    assertSafePath(prepared.adapter.home, prepared.adapter.record);
    removeExact(prepared.adapter.record);
  }
  if (prepared.recordBackup && existsSync(prepared.recordBackup)) {
    assertSafePath(prepared.adapter.home, prepared.recordBackup);
    assertSafePath(prepared.adapter.home, prepared.adapter.record);
    renameSync(prepared.recordBackup, prepared.adapter.record);
  }
  for (const path of [...prepared.installed].reverse()) {
    assertSafePath(prepared.adapter.home, path);
    removeExact(path);
  }
  for (const { original, backup } of [...prepared.backups].reverse()) {
    assertSafePath(prepared.adapter.home, original);
    assertSafePath(prepared.adapter.home, backup);
    if (existsSync(backup)) renameSync(backup, original);
  }
  for (let index = 0; index < prepared.ignoreWritten; index += 1) {
    const ignore = prepared.adapter.localIgnoreFiles?.[index];
    const snapshot = prepared.ignoreSnapshots[index];
    if (!ignore || !snapshot) continue;
    assertSafePath(ignoreRoot(prepared.adapter, ignore), snapshot.path);
    restoreSnapshots([snapshot]);
  }
  assertSafePath(prepared.adapter.home, prepared.stageRoot);
  removeExact(prepared.stageRoot);
}

export function installAll(adapters: Adapter[], options: InstallOptions = {}): InstallResult[] {
  assertNonOverlappingAdapters(adapters);
  return withAdapterLocks(adapters, () => {
    const prepared: PreparedInstall[] = [];
    try {
      for (const adapter of adapters) prepared.push(prepareInstall(adapter, options));
      const stamp = options.stamp || timestamp();
      for (const item of prepared) commitInstall(item, stamp);
      const initialization =
        prepared.length > 0
          ? initializeUserData(prepared[0], options.env || process.env, {
              global: !options.noInitGlobal,
              afterInitialize: options.afterUserDataInitialize,
            })
          : '';
      return prepared.map(({ adapter, backups }) => ({
        ...describeInstall(adapter),
        initializeGlobalMemory: !options.noInitGlobal,
        backups,
        initialization,
      }));
    } catch (error) {
      const rollbackErrors: string[] = [];
      for (const item of [...prepared].reverse()) {
        try {
          rollbackInstall(item);
        } catch (rollbackError) {
          rollbackErrors.push(`${item.adapter.label}: ${errorMessage(rollbackError)}`);
        }
      }
      if (rollbackErrors.length > 0) {
        throw new Error(
          `Installation failed and rollback was incomplete: ${errorMessage(error)}; rollback: ${rollbackErrors.join('; ')}`,
          { cause: error instanceof Error ? error : undefined },
        );
      }
      throw error;
    }
  });
}

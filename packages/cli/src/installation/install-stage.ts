import { mkdirSync, mkdtempSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { renderMarkdownInstructions } from '../adapters/instruction-formats.js';
import { atomicWrite, copyRenderedTree, removeExact } from '../shared/files.js';
import { assertSafePath, assertSafeScopePaths } from '../shared/safe-path.js';
import type {
  Adapter,
  Hub,
  InstallOptions,
  InstallRecord,
  ManagedScope,
  PreparedInstall,
  StagedOutput,
} from '../shared/types.js';
import { errorMessage, HarnessmithError } from '../shared/types.js';
import {
  checkModules,
  harnessTemplateRoot,
  installationRenderer,
  installationValues,
  isHarnessDistributionPath,
  templateRoot,
} from './install-template.js';
import {
  hubSeeds,
  type PlannedMigration,
  plannedAdapterMigrations,
  plannedHubMigrations,
} from './layout-migration.js';
import { stageLink } from './links.js';
import {
  assertScopeContract,
  digestManagedOutput,
  plannedOutputs,
  readInstallRecord,
  snapshotFiles,
} from './records.js';

function assertInstallable(
  scope: ManagedScope,
  record: InstallRecord | null,
  force: boolean,
): void {
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
  scope: ManagedScope,
  expected: Record<string, string | null> | undefined,
): void {
  if (!expected) return;
  for (const { path } of scope.outputs) {
    if (!(path in expected) || digestManagedOutput(scope, path) !== expected[path]) {
      throw new HarnessmithError(
        'STATE_CONFLICT',
        `Adopt proposal changed before installation: ${path}`,
        3,
      );
    }
  }
}

function openStage(
  scope: ManagedScope,
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

function prepared(
  scope: ManagedScope,
  stageRoot: string,
  outputs: StagedOutput[],
  migrations: PlannedMigration[],
  seeds: PreparedInstall['seeds'] = [],
): PreparedInstall {
  return {
    scope,
    stageRoot,
    outputs,
    migrations,
    seeds,
    seeded: [],
    backups: [],
    installed: [],
    recordBackup: null,
    recordWritten: false,
    ignoreWritten: 0,
    ignoreSnapshots: snapshotFiles(scope.localIgnoreFiles || []),
  };
}

export function renderedEntry(hub: Hub, env: NodeJS.ProcessEnv): string {
  const render = installationRenderer(hub, env);
  return render(readFileSync(join(templateRoot, 'template', 'entry', 'AGENTS.md'), 'utf8'));
}

/**
 * Stage the hub: the rendered skill, the shared always-on entry and the
 * `~/.agents/skills/agent-harness` discovery link. Hosts whose pre-hub Harness copies are
 * retired by this install contribute their `state/` to the hub state.
 */
export function prepareHub(
  hub: Hub,
  adapters: Adapter[],
  options: InstallOptions = {},
): PreparedInstall {
  const env = options.env ?? process.env;
  const { stageRoot } = openStage(hub, options);
  try {
    const render = installationRenderer(hub, env);
    const stagedHarness = join(stageRoot, 'agent-harness');
    copyRenderedTree(harnessTemplateRoot, stagedHarness, render, '', isHarnessDistributionPath);
    atomicWrite(
      join(stagedHarness, 'install-context.json'),
      `${JSON.stringify(installationValues(hub, env), null, 2)}\n`,
    );
    checkModules(stagedHarness);
    const stagedEntry = join(stageRoot, 'AGENTS.md');
    atomicWrite(stagedEntry, renderMarkdownInstructions(renderedEntry(hub, env)));
    const stagedDiscovery = join(stageRoot, 'discovery-link');
    const link = stageLink(stagedDiscovery, hub.harness, stagedHarness);
    const migrations = plannedHubMigrations(hub);
    const retired = adapters
      .filter((adapter) => plannedAdapterMigrations(adapter, readInstallRecord(adapter)).length > 0)
      .map((adapter) => adapter.legacyHarness);
    const outputs: StagedOutput[] = [
      { staged: stagedHarness, destination: hub.harness, kind: 'tree', root: hub.home },
      { staged: stagedEntry, destination: hub.entry, kind: 'file', root: hub.home },
      {
        staged: stagedDiscovery,
        destination: hub.discoveryLink,
        kind: 'link',
        root: hub.agentsHome,
        ...link,
      },
    ];
    return prepared(hub, stageRoot, outputs, migrations, hubSeeds(hub, migrations, retired));
  } catch (error) {
    removeExact(stageRoot);
    throw new Error(`Could not stage ${hub.label}: ${errorMessage(error)}`);
  }
}

/** Stage one host: symlinks into the staged hub plus any host-specific rendered rule files. */
export function prepareInstall(
  adapter: Adapter,
  hubStage: PreparedInstall,
  options: InstallOptions = {},
): PreparedInstall {
  const env = options.env ?? process.env;
  const { record, stageRoot } = openStage(adapter, options);
  try {
    const sourceFor = (target: string): string => {
      const staged = hubStage.outputs.find(({ destination }) => destination === target);
      if (!staged) throw new Error(`Link target is not part of the hub: ${target}`);
      return staged.staged;
    };
    const entry = renderedEntry(adapter.hub, env);
    const outputs: StagedOutput[] = adapter.outputs.map((output, index) => {
      const staged = join(stageRoot, 'outputs', String(index));
      mkdirSync(join(stageRoot, 'outputs'), { recursive: true });
      if (output.kind === 'link' && output.target) {
        const link = stageLink(staged, output.target, sourceFor(output.target));
        return { staged, destination: output.path, kind: 'link', root: adapter.home, ...link };
      }
      const instruction = adapter.instructions.find(({ path }) => path === output.path);
      if (instruction?.mode !== 'render') {
        throw new Error(`No renderer for host output: ${output.path}`);
      }
      atomicWrite(staged, instruction.render(entry));
      return { staged, destination: output.path, kind: 'file', root: adapter.home };
    });
    return prepared(adapter, stageRoot, outputs, plannedAdapterMigrations(adapter, record));
  } catch (error) {
    removeExact(stageRoot);
    throw new Error(`Could not stage ${adapter.label}: ${errorMessage(error)}`);
  }
}

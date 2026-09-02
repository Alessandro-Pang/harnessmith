import { createHash } from 'node:crypto';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkedRegistryRun } from './registry-verification-registry.js';
import {
  RegistryVerificationError,
  type RegistryVerificationOptions,
  type RegistryVerificationReport,
  type RegistryVerificationRunner,
} from './registry-verification-types.js';

export interface RegistrySmokePaths {
  codexHome: string;
  home: string;
  installRoot: string;
  workspace: string;
}

function directorySnapshot(root: string): string {
  const records: string[] = [];
  const visit = (directory: string): void => {
    const entries = readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    );
    for (const entry of entries) {
      const path = join(directory, entry.name);
      const relative = path.slice(root.length + 1);
      const stat = lstatSync(path);
      if (stat.isSymbolicLink()) {
        throw new Error(`Dry-run target contains a symbolic link: ${path}`);
      }
      if (stat.isDirectory()) {
        records.push(`d:${relative}`);
        visit(path);
      } else if (stat.isFile()) {
        const digest = createHash('sha256').update(readFileSync(path)).digest('hex');
        records.push(`f:${relative}:${stat.mode}:${digest}`);
      } else throw new Error(`Dry-run target contains an unsupported entry: ${path}`);
      if (records.length > 10_000) throw new Error('Dry-run target snapshot entry limit exceeded');
    }
  };
  visit(root);
  return createHash('sha256').update(records.join('\n')).digest('hex');
}

function parseJson(label: string, content: string): unknown {
  try {
    return JSON.parse(content);
  } catch {
    throw new RegistryVerificationError(
      'REGISTRY_RUNTIME_FAILURE',
      `${label} did not return valid JSON`,
    );
  }
}

export function runRegistrySmoke(
  options: RegistryVerificationOptions,
  paths: RegistrySmokePaths,
  env: NodeJS.ProcessEnv,
  runner: RegistryVerificationRunner,
): RegistryVerificationReport['smoke'] {
  const cli = join(
    paths.installRoot,
    'node_modules',
    options.packageName,
    'bin',
    'harnessmith.mjs',
  );
  const runCli = (label: string, args: string[]): string =>
    checkedRegistryRun(
      label,
      process.execPath,
      [cli, ...args],
      { cwd: paths.workspace, env },
      runner,
    );
  if (runCli('CLI version smoke', ['--version']).trim() !== options.version) {
    throw new RegistryVerificationError(
      'REGISTRY_RUNTIME_FAILURE',
      `Installed CLI version does not match ${options.version}`,
    );
  }
  parseJson('CLI capabilities smoke', runCli('CLI capabilities smoke', ['capabilities', '--json']));
  const beforeDryRun = directorySnapshot(paths.home);
  parseJson(
    'CLI dry-run smoke',
    runCli('CLI dry-run smoke', ['install', '--agent', 'codex', '--dry-run', '--json', '--yes']),
  );
  if (directorySnapshot(paths.home) !== beforeDryRun) {
    throw new RegistryVerificationError(
      'REGISTRY_RUNTIME_FAILURE',
      'CLI dry-run modified the isolated user home',
    );
  }
  parseJson(
    'CLI install smoke',
    runCli('CLI install smoke', ['install', '--agent', 'codex', '--json', '--yes']),
  );
  const harnessCli = join(paths.codexHome, 'agent-harness', 'bin', 'harness.mjs');
  checkedRegistryRun(
    'Harness doctor smoke',
    process.execPath,
    [harnessCli, 'doctor'],
    { cwd: paths.workspace, env },
    runner,
  );
  const health = checkedRegistryRun(
    'Harness health smoke',
    process.execPath,
    [harnessCli, 'health', '--json'],
    { cwd: paths.workspace, env },
    runner,
  );
  if ((parseJson('Harness health smoke', health) as { healthy?: boolean }).healthy !== true) {
    throw new RegistryVerificationError(
      'REGISTRY_RUNTIME_FAILURE',
      'Harness health smoke reported an unhealthy installation',
    );
  }
  return {
    version: true,
    capabilities: true,
    dryRunNoWrite: true,
    install: true,
    doctor: true,
    health: true,
  };
}

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkDocs } from './preflight-docs.js';

type Mode = 'all' | 'cli' | 'docs';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const harnessRoot = join(root, 'template', 'agent-harness');
const errors: string[] = [];
let passed = 0;

function check(condition: unknown, message: string): void {
  if (condition) {
    passed += 1;
    return;
  }
  errors.push(message);
}

function read(path: string): string {
  return readFileSync(path, 'utf8');
}

function runNode(entry: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const result = spawnSync(process.execPath, [entry, ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
  });
  check(
    result.status === 0,
    `${relative(root, entry)} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`,
  );
  return result.stdout;
}

function checkPackage(): void {
  const manifest = JSON.parse(read(join(root, 'package.json'))) as {
    name?: string;
    version?: string;
    bin?: Record<string, string>;
    files?: string[];
    packageManager?: string;
    scripts?: Record<string, string>;
  };
  check(manifest.name === 'harnessmith', 'package name must remain harnessmith');
  check(Boolean(manifest.version), 'package version is missing');
  check(manifest.packageManager === 'pnpm@10.13.0', 'package manager must remain pnpm@10.13.0');
  check(existsSync(join(root, 'pnpm-lock.yaml')), 'pnpm-lock.yaml is missing');
  check(
    !existsSync(join(root, 'package-lock.json')),
    'package-lock.json conflicts with the pnpm lockfile',
  );
  for (const [name, command] of Object.entries(manifest.scripts ?? {})) {
    check(
      !/(^|[;&|]\s*)npm run\b/.test(command),
      `package script ${name} must compose scripts with pnpm`,
    );
  }
  check(manifest.bin?.harnessmith === 'bin/harnessmith.mjs', 'package bin mapping is invalid');
  for (const required of [
    'bin',
    'dist',
    'template/AGENTS.md',
    'template/agent-harness/bin',
    'template/agent-harness/dist',
    'template/agent-harness/docs',
    'template/agent-harness/manifest.json',
    'template/agent-harness/schemas',
    'template/agent-harness/templates',
    'evals/run.schema.json',
    'evals/run.example.json',
    'docs/architecture.md',
    'llms.txt',
  ]) {
    check(manifest.files?.includes(required), `npm package files is missing ${required}`);
  }
  check(
    !manifest.files?.some(
      (path) =>
        path === 'template' || path.includes('agent-harness/src') || path.includes('__tests__'),
    ),
    'npm package files must not publish TypeScript sources or test directories',
  );
  check(existsSync(join(root, 'bin', 'harnessmith.mjs')), 'outer CLI launcher is missing');
  check(existsSync(join(harnessRoot, 'bin', 'harness.mjs')), 'Harness CLI launcher is missing');
  check(
    existsSync(join(harnessRoot, 'dist', 'harness.mjs')),
    'Harness bundle is missing; run pnpm run build',
  );

  const workflow = read(join(root, '.github', 'workflows', 'ci.yml'));
  check(workflow.includes('pnpm/action-setup@v6'), 'CI must set up pnpm with the supported action');
  check(
    workflow.includes('pnpm install --frozen-lockfile --ignore-scripts'),
    'CI must install the frozen pnpm lockfile without lifecycle scripts',
  );
  check(!workflow.includes('npm ci'), 'CI must not install dependencies with npm');

  const llms = read(join(root, 'llms.txt'));
  check(
    llms.includes('Release status: unreleased'),
    'llms.txt must identify the unreleased registry state',
  );
  check(
    read(join(root, 'README.md')).includes('尚未发布到 npm'),
    'README.md must identify the unreleased registry state',
  );
  check(
    read(join(root, 'README.en.md')).includes('not yet published to npm'),
    'README.en.md must identify the unreleased registry state',
  );
  check(
    read(join(root, 'SECURITY.md')).includes('No versions have been published yet'),
    'SECURITY.md must not imply a published version exists',
  );
}

function checkBranch(): void {
  const result = spawnSync('git', ['branch', '--show-current'], {
    cwd: root,
    encoding: 'utf8',
  });
  check(result.status === 0, `unable to inspect current Git branch: ${result.stderr.trim()}`);
  const branch = result.stdout.trim();
  if (!branch || ['main', 'master', 'develop'].includes(branch)) return;
  check(
    /^(?:feature|hotfix|refactor)\/\d{8}_[a-z0-9]+(?:-[a-z0-9]+)*$/.test(branch),
    `branch name does not match (feature|hotfix|refactor)/YYYYMMDD_<feature-name>: ${branch}`,
  );
}

function checkCli(): void {
  checkBranch();
  checkPackage();
  const outerCli = join(root, 'bin', 'harnessmith.mjs');
  const harnessCli = join(harnessRoot, 'bin', 'harness.mjs');
  const outerHelp = runNode(outerCli, ['--help']);
  for (const command of ['install', 'status', 'restore', 'uninstall']) {
    check(outerHelp.includes(command), `outer CLI help is missing ${command}`);
  }
  const harnessHelp = runNode(harnessCli, ['--help']);
  for (const command of ['init', 'memory', 'project', 'task', 'validate', 'doctor']) {
    check(harnessHelp.includes(command), `Harness CLI help is missing ${command}`);
  }
  const memoryHelp = runNode(harnessCli, ['memory', '--help']);
  for (const command of ['list', 'search', 'check', 'supersede', 'archive', 'promote']) {
    check(memoryHelp.includes(command), `Harness memory help is missing ${command}`);
  }
  const versionContract = JSON.parse(runNode(harnessCli, ['version', '--json'])) as {
    version?: number;
    harnessVersion?: string;
    schemaVersion?: number;
    memorySchemaVersion?: number;
  };
  check(versionContract.version === 1, 'Harness version contract must remain version 1');
  check(Boolean(versionContract.harnessVersion), 'Harness version contract is missing version');
  check(versionContract.schemaVersion === 1, 'Harness task schema version is unsupported');
  check(versionContract.memorySchemaVersion === 1, 'Harness memory schema version is unsupported');

  const temporary = mkdtempSync(join(tmpdir(), 'harnessmith-preflight-'));
  try {
    const env = {
      ...process.env,
      HOME: temporary,
      CODEX_HOME: join(temporary, 'host'),
      HARNESS_MEMORY_HOME: join(temporary, 'memory'),
      HARNESS_REPOSITORY_ROOT: join(temporary, 'repositories'),
      HARNESS_OWNER: 'preflight',
    };
    const preview = runNode(
      outerCli,
      ['install', '--agent', 'codex', '--dry-run', '--yes', '--json'],
      env,
    );
    const plan = JSON.parse(preview) as { adapter?: string; outputs?: unknown[] };
    check(plan.adapter === 'codex', 'outer CLI dry-run returned the wrong adapter plan');
    check(Boolean(plan.outputs?.length), 'outer CLI dry-run did not return planned outputs');
    check(
      !existsSync(join(temporary, 'host')),
      'outer CLI dry-run unexpectedly wrote to the host directory',
    );

    const installed = runNode(
      outerCli,
      ['install', '--agent', 'codex', '--no-init-global', '--yes', '--json'],
      env,
    );
    const installation = JSON.parse(installed) as { command?: string; results?: unknown[] };
    check(installation.command === 'install', 'outer CLI install returned the wrong command');
    check(installation.results?.length === 1, 'outer CLI install did not return one result');
    const installedHarnessCli = join(temporary, 'host', 'agent-harness', 'bin', 'harness.mjs');
    check(
      !existsSync(join(temporary, 'host', 'agent-harness', 'src')),
      'installed Harness unexpectedly contains TypeScript sources',
    );
    const validationOutput = runNode(installedHarnessCli, ['validate', '--json'], env);
    const validation = JSON.parse(validationOutput) as { valid?: boolean };
    check(validation.valid === true, 'installed Harness validation did not pass');
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

function main(): void {
  const mode = (process.argv[2] ?? 'all') as Mode;
  if (!['all', 'cli', 'docs'].includes(mode)) {
    throw new Error('Usage: tsx scripts/preflight.ts [all|cli|docs]');
  }
  if (mode === 'all' || mode === 'docs') checkDocs({ root, harnessRoot, check });
  if (mode === 'all' || mode === 'cli') checkCli();
  if (errors.length > 0) throw new Error(`Preflight failed:\n- ${errors.join('\n- ')}`);
  console.log(`Preflight passed (${mode}): ${passed} checks`);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

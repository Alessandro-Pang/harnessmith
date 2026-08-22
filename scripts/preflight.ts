import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Argument, Command } from 'commander';
import { execaSync } from 'execa';
import { checkArchitectureImports } from './preflight-architecture.js';
import { checkDocs } from './preflight-docs.js';
import { checkBranch } from './preflight-git.js';
import { checkPackage } from './preflight-package.js';

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

function runNode(entry: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const result = execaSync(process.execPath, [entry, ...args], {
    cwd: root,
    encoding: 'utf8',
    env,
    reject: false,
  });
  check(
    result.exitCode === 0,
    `${relative(root, entry)} ${args.join(' ')} failed: ${(result.stderr || result.stdout).trim()}`,
  );
  return result.stdout;
}

function checkHelp(output: string, subject: string, expected: string): void {
  for (const value of expected.split(' '))
    check(output.includes(value), `${subject} is missing ${value}`);
}

function checkCliHelp(outerCli: string, harnessCli: string): void {
  const outerHelp = runNode(outerCli, ['--help']);
  checkHelp(outerHelp, 'outer CLI help', 'install capabilities status restore uninstall');
  const harnessHelp = runNode(harnessCli, ['--help']);
  checkHelp(
    harnessHelp,
    'Harness CLI help',
    'init memory project task validate doctor health route explain search',
  );
  const memoryHelp = runNode(harnessCli, ['memory', '--help']);
  checkHelp(
    memoryHelp,
    'Harness memory help',
    'list search check maintain migrate supersede archive promote',
  );
  const searchFlags =
    '--limit --max-line-length --max-depth --max-files --max-file-bytes --max-total-bytes --json';
  checkHelp(runNode(harnessCli, ['search', '--help']), 'Harness search help', searchFlags);
  checkHelp(runNode(harnessCli, ['memory', 'search', '--help']), 'Memory search help', searchFlags);
  const memoryListHelp = runNode(harnessCli, ['memory', 'list', '--help']);
  checkHelp(memoryListHelp, 'Harness memory list help', '--json');
  const memoryCheckHelp = runNode(harnessCli, ['memory', 'check', '--help']);
  checkHelp(memoryCheckHelp, 'Harness memory check help', '--indexed --json');
  const memoryMigrateHelp = runNode(harnessCli, ['memory', 'migrate', '--help']);
  checkHelp(memoryMigrateHelp, 'Harness memory migrate help', '--set --apply --json');
  const taskVerifyHelp = runNode(harnessCli, ['task', 'verify', '--help']);
  checkHelp(
    taskVerifyHelp,
    'Harness task verify help',
    '--id --criterion --type --command --arg --scope --file --timeout-ms --json',
  );
}

function checkCli(): void {
  checkArchitectureImports(join(harnessRoot, 'src'), check);
  checkBranch(root, check);
  checkPackage(root, harnessRoot, check);
  const outerCli = join(root, 'bin', 'harnessmith.mjs');
  const harnessCli = join(harnessRoot, 'bin', 'harness.mjs');
  checkCliHelp(outerCli, harnessCli);
  const versionContract = JSON.parse(runNode(harnessCli, ['version', '--json'])) as {
    version?: number;
    harnessVersion?: string;
    schemaVersion?: number;
    memorySchemaVersion?: number;
  };
  check(versionContract.version === 1, 'Harness version contract must remain version 1');
  check(Boolean(versionContract.harnessVersion), 'Harness version contract is missing version');
  check(versionContract.schemaVersion === 3, 'Harness task schema version is unsupported');
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
  const program = new Command()
    .exitOverride()
    .configureOutput({ writeOut: () => undefined, writeErr: () => undefined })
    .addArgument(new Argument('[mode]').choices(['all', 'cli', 'docs']).default('all'));
  program.parse(process.argv.slice(2), { from: 'user' });
  const mode = program.processedArgs[0] as Mode;
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

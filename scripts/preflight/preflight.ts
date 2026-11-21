import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Argument, Command } from 'commander';
import { execaSync } from 'execa';
import { checkBuiltCliAdapters } from './preflight-adapters.js';
import {
  checkArchitectureImports,
  checkAreaImportEdges,
  declaredCliAreaCycles,
  declaredCliAreaImports,
} from './preflight-architecture.js';
import { checkAreaImportCycles } from './preflight-architecture-cycles.js';
import { checkDocs } from './preflight-docs.js';
import { checkBranch } from './preflight-git.js';
import { checkPackage } from './preflight-package.js';

type Mode = 'all' | 'cli' | 'docs';
const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const harnessRoot = join(root, 'template', 'skills', 'agent-harness');
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

function checkCliHelp(cli: string): void {
  const help = runNode(cli, ['--help']);
  checkHelp(help, 'outer CLI help', 'install capabilities status restore uninstall');
  checkHelp(
    help,
    'Harness CLI help',
    'init memory project task validate doctor health route explain search',
  );
  const memoryHelp = runNode(cli, ['memory', '--help']);
  checkHelp(
    memoryHelp,
    'Harness memory help',
    'list search check maintain migrate supersede archive promote',
  );
  const searchFlags =
    '--limit --max-line-length --max-depth --max-files --max-file-bytes --max-total-bytes --json';
  checkHelp(runNode(cli, ['search', '--help']), 'Harness search help', searchFlags);
  checkHelp(runNode(cli, ['memory', 'search', '--help']), 'Memory search help', searchFlags);
  const memoryListHelp = runNode(cli, ['memory', 'list', '--help']);
  checkHelp(memoryListHelp, 'Harness memory list help', '--json');
  const memoryCheckHelp = runNode(cli, ['memory', 'check', '--help']);
  checkHelp(memoryCheckHelp, 'Harness memory check help', '--indexed --json');
  const memoryMigrateHelp = runNode(cli, ['memory', 'migrate', '--help']);
  checkHelp(memoryMigrateHelp, 'Harness memory migrate help', '--set --apply --json');
  const taskVerifyHelp = runNode(cli, ['task', 'verify', '--help']);
  checkHelp(
    taskVerifyHelp,
    'Harness task verify help',
    '--id --criterion --type --command --arg --scope --file --timeout-ms --json',
  );
}

function checkCli(): void {
  // Runtime sources live in packages/harness/src; the only executable bundle is at the package root.
  checkArchitectureImports(join(root, 'packages', 'harness', 'src'), check);
  checkAreaImportCycles(join(root, 'packages', 'harness', 'src', 'lib'), [], check);
  checkAreaImportEdges(join(root, 'packages', 'cli', 'src'), declaredCliAreaImports, check);
  checkAreaImportCycles(join(root, 'packages', 'cli', 'src'), declaredCliAreaCycles, check);
  checkBranch(root, check);
  checkPackage(root, harnessRoot, check);
  const cli = join(root, 'bin', 'harnessmith.mjs');
  checkCliHelp(cli);
  const versionContract = JSON.parse(runNode(cli, ['version', '--json'])) as {
    version?: number;
    harnessVersion?: string;
    schemaVersion?: number;
    memorySchemaVersion?: number;
  };
  check(versionContract.version === 1, 'Harness version contract must remain version 1');
  check(Boolean(versionContract.harnessVersion), 'Harness version contract is missing version');
  check(versionContract.schemaVersion === 3, 'Harness task schema version is unsupported');
  check(versionContract.memorySchemaVersion === 1, 'Harness memory schema version is unsupported');

  checkBuiltCliAdapters({ outerCli: cli, runNode, check });
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

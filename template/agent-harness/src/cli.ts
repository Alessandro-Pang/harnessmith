import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import { doctor } from './commands/doctor.js';
import { initGlobal, initPersonal, initProject } from './commands/init.js';
import { inspectProject } from './commands/project.js';
import { contextSearch } from './commands/search.js';
import { validate } from './commands/validate.js';
import { registerMemoryCommands } from './program/memory.js';
import { registerTaskCommands } from './program/task.js';
import type { CommandRunner } from './program/types.js';
import { createRuntime } from './runtime.js';
import type { Io, Runtime } from './types.js';

interface JsonProjectOptions {
  json?: boolean;
  project?: string;
}
function outputAdapter(io: Io) {
  return {
    writeOut: (value: string) => io.log(value.trimEnd()),
    writeErr: (value: string) => io.error(value.trimEnd()),
  };
}

interface HarnessManifest {
  harnessVersion: string;
  schemaVersion: number;
  memorySchemaVersion: number;
  node: string;
}

function registerCoreCommands(
  program: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
  manifest: HarnessManifest,
): void {
  program
    .command('version')
    .description('print the Harness version')
    .option('--json', 'write the version and schema compatibility contract as JSON')
    .action(
      run((options: { json?: boolean }) =>
        io.log(
          options.json
            ? JSON.stringify({
                version: 1,
                harnessVersion: manifest.harnessVersion,
                schemaVersion: manifest.schemaVersion,
                memorySchemaVersion: manifest.memorySchemaVersion,
                node: manifest.node,
              })
            : manifest.harnessVersion,
        ),
      ),
    );
  program
    .command('doctor')
    .description('check the Harness runtime and shared memory')
    .action(run(() => doctor(runtime, {}, io)));
  program
    .command('validate')
    .description('validate the installation and optional project')
    .option('--project <path>', 'project path')
    .option('--json', 'write machine-readable JSON')
    .action(run((options: JsonProjectOptions) => validate(runtime, options, io)));

  const project = program.command('project').description('inspect project context');
  project
    .command('inspect [path]')
    .description('inspect a project')
    .option('--json', 'write machine-readable JSON')
    .action(
      run((path: string = process.cwd(), options: { json?: boolean }) =>
        inspectProject(path, options, io),
      ),
    );

  const init = program.command('init').description('initialize memory scaffolding');
  init
    .command('global')
    .description('initialize shared global memory')
    .action(run(() => initGlobal(runtime, io)));
  init
    .command('personal')
    .description('initialize the shared personal rules overlay')
    .action(run(() => initPersonal(runtime, io)));
  init
    .command('project [path]')
    .description('initialize project memory')
    .action(run((path = '.') => initProject(runtime, path, io)));
}

export function createHarnessProgram(runtime: Runtime = createRuntime(), io: Io = console) {
  let exitCode = 0;
  const run: CommandRunner =
    <TArgs extends unknown[]>(operation: (...args: TArgs) => unknown) =>
    (...args: TArgs): void => {
      const result = operation(...args);
      exitCode = typeof result === 'number' && Number.isInteger(result) ? result : 0;
    };
  const manifest = JSON.parse(
    readFileSync(join(runtime.harnessRoot, 'manifest.json'), 'utf8'),
  ) as HarnessManifest;
  const program = new Command()
    .name('harness')
    .description('Personal Agent Harness runtime')
    .version(manifest.harnessVersion)
    .exitOverride()
    .showHelpAfterError()
    .configureHelp({ showGlobalOptions: true })
    .configureOutput(outputAdapter(io));

  registerCoreCommands(program, runtime, io, run, manifest);

  registerTaskCommands(program, runtime, io, run);
  registerMemoryCommands(program, runtime, io, run);

  program
    .command('search <query...>')
    .description('search routed Harness and project context')
    .option('--project <path>', 'project path', process.cwd())
    .action(
      run((query: string[], options: { project: string }) =>
        contextSearch(runtime, query.join(' '), options.project, io),
      ),
    );

  return { program, exitCode: () => exitCode };
}

export function runCli(
  args: string[],
  { runtime = createRuntime(), io = console }: { runtime?: Runtime; io?: Io } = {},
): number {
  const harness = createHarnessProgram(runtime, io);
  try {
    harness.program.parse(args, { from: 'user' });
  } catch (error) {
    const commandError = error as Error & { code?: string; commanderHandled?: boolean };
    if (['commander.helpDisplayed', 'commander.version'].includes(commandError.code || ''))
      return 0;
    if (commandError.code?.startsWith('commander.')) commandError.commanderHandled = true;
    throw error;
  }
  return harness.exitCode();
}

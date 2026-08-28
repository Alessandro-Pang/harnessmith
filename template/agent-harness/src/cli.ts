import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Command, Option } from 'commander';
import { doctor } from './commands/doctor.js';
import { health } from './commands/health.js';
import { initGlobal, initPersonal, initProject } from './commands/init.js';
import { inspectProject } from './commands/project.js';
import { route } from './commands/route.js';
import { contextSearch } from './commands/search.js';
import { validate } from './commands/validate.js';
import { containsHighConfidenceSecret } from './lib/secret-hygiene.js';
import { registerAuditCommands } from './program/audit.js';
import { registerMemoryCommands } from './program/memory.js';
import { registerRepositoryMapCommands } from './program/repository-map.js';
import { addSearchOptions, type SearchCommandOptions } from './program/search-options.js';
import { registerTaskCommands } from './program/task.js';
import type { CommandRunner } from './program/types.js';
import { createRuntime } from './runtime.js';
import type { Io, Runtime } from './types.js';

interface JsonProjectOptions {
  json?: boolean;
  project?: string;
}

interface CoordinationOptions {
  coordinationKeys?: string;
}

function coordinationKeys(value: string | undefined): string[] {
  if (!value) return [];
  const keys = [...new Set(value.split(',').filter(Boolean))];
  if (keys.some((key) => !/^[0-9a-f]{64}\.[0-9a-f]{64}$/.test(key))) {
    throw new Error('Invalid internal coordination key');
  }
  return keys;
}

function addCoordinationOption(command: Command): Command {
  return command.addOption(
    new Option('--coordination-keys <keys>', 'internal parent-held lock keys').hideHelp(),
  );
}
function outputAdapter(io: Io) {
  return {
    writeOut: (value: string) => io.log(value.trimEnd()),
    writeErr: (value: string) => io.error(value.trimEnd()),
  };
}

const redactedCommandDiagnostic =
  'Command output redacted because it contains high-confidence secret material';

function redactingCommandIo(io: Io): Io {
  const emit = (operation: Io['log'], values: unknown[]) => {
    const containsSecret = values.some((value) =>
      containsHighConfidenceSecret(typeof value === 'string' ? value : String(value ?? '')),
    );
    if (containsSecret) operation.call(io, redactedCommandDiagnostic);
    else operation.call(io, ...values);
  };
  return {
    log: (message: unknown = '', ...optional: unknown[]) => emit(io.log, [message, ...optional]),
    error: (message: unknown = '', ...optional: unknown[]) =>
      emit(io.error, [message, ...optional]),
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
    .command('health')
    .description('aggregate runtime, installation, memory, and audit health')
    .option('--project <path>', 'include project memory health')
    .option('--json', 'write a machine-readable health report')
    .action(run((options: { project?: string; json?: boolean }) => health(runtime, options, io)));
  program
    .command('validate')
    .description('validate the installation and optional project')
    .option('--project <path>', 'project path')
    .option('--json', 'write machine-readable JSON')
    .action(run((options: JsonProjectOptions) => validate(runtime, options, io)));
  program
    .command('route <query...>')
    .description('route task terms to relevant Harness documentation')
    .option('--json', 'write machine-readable routes without document bodies')
    .action(
      run((query: string[], options: { json?: boolean }) => route(runtime, query, options, io)),
    );
  program
    .command('explain <query...>')
    .description('explain which Harness documents govern a topic without loading their bodies')
    .option('--json', 'write machine-readable routes without document bodies')
    .action(
      run((query: string[], options: { json?: boolean }) => route(runtime, query, options, io)),
    );

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
  addCoordinationOption(
    init.command('global').description('initialize shared global memory'),
  ).action(
    run((options: CoordinationOptions) =>
      initGlobal(runtime, io, coordinationKeys(options.coordinationKeys)),
    ),
  );
  addCoordinationOption(
    init.command('personal').description('initialize the shared personal rules overlay'),
  ).action(
    run((options: CoordinationOptions) =>
      initPersonal(runtime, io, coordinationKeys(options.coordinationKeys)),
    ),
  );
  init
    .command('project [path]')
    .description('initialize project memory')
    .action(run((path = '.') => initProject(runtime, path, io)));
}

export function createHarnessProgram(runtime: Runtime = createRuntime(), outputIo: Io = console) {
  const io = redactingCommandIo(outputIo);
  let exitCode = 0;
  const run: CommandRunner =
    <TArgs extends unknown[]>(operation: (...args: TArgs) => unknown) =>
    (...args: TArgs): void => {
      try {
        const result = operation(...args);
        exitCode = typeof result === 'number' && Number.isInteger(result) ? result : 0;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (containsHighConfidenceSecret(message)) throw new Error(redactedCommandDiagnostic);
        throw error;
      }
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

  registerAuditCommands(program, runtime, io, run);
  registerTaskCommands(program, runtime, io, run);
  registerMemoryCommands(program, runtime, io, run);
  registerRepositoryMapCommands(program, runtime, io, run);

  addSearchOptions(
    program
      .command('search <query...>')
      .description('search routed Harness and project context')
      .option('--project <path>', 'project path', process.cwd()),
  ).action(
    run((query: string[], options: SearchCommandOptions & { project: string }) =>
      contextSearch(runtime, query.join(' '), options.project, io, options),
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

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Command, Option } from 'commander';
import { collectAgents } from './agents.js';
import type { CliOptions } from './types.js';

export type HarnessmithCommand = 'install' | 'status' | 'restore' | 'uninstall';
export type CommandExecutor = (
  command: HarnessmithCommand,
  options: CliOptions,
) => void | Promise<void>;

const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const manifest = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));

function addSharedOptions(command: Command): Command {
  return command
    .addOption(
      new Option('-a, --agent <name>', 'target agent; repeat or use comma-separated values')
        .argParser(collectAgents)
        .default([] as string[]),
    )
    .option('--project <path>', 'Cursor project root', process.cwd())
    .option('--force', 'back up and replace unmanaged or modified files')
    .option('--json', 'write machine-readable JSON')
    .option('-y, --yes', 'disable prompts and default to Codex when no agent is supplied');
}

export function createProgram(
  execute: CommandExecutor,
  {
    output = process.stdout,
    error = process.stderr,
  }: {
    output?: NodeJS.WritableStream;
    error?: NodeJS.WritableStream;
  } = {},
): Command {
  const program = addSharedOptions(new Command())
    .name('harnessmith')
    .description('Forge and safely manage a portable personal coding-agent harness.')
    .version(manifest.version, '-v, --version')
    .exitOverride()
    .configureHelp({ showGlobalOptions: true })
    .option('--dry-run', 'preview destinations without writing')
    .option('--no-init-global', 'skip shared global-memory initialization')
    .showHelpAfterError()
    .configureOutput({
      writeOut: (value) => output.write(value),
      writeErr: (value) => error.write(value),
    });

  program.action(() => execute('install', program.opts<CliOptions>()));

  const install = program.command('install').description('install or upgrade the harness');
  install.action(() => execute('install', install.optsWithGlobals<CliOptions>()));

  for (const [name, description] of [
    ['status', 'inspect installation ownership and integrity'],
    ['restore', 'restore the previous installation layer'],
    ['uninstall', 'restore all layers and remove the installation'],
  ] as const) {
    const command = program.command(name).description(description);
    command.action(() => execute(name, command.optsWithGlobals<CliOptions>()));
  }
  return program;
}

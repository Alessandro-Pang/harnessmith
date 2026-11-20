import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { templateRoot } from '../installation/install-template.js';
import type { Io } from '../shared/types.js';

const runtimeCommands = new Set([
  'audit',
  'bootstrap',
  'doctor',
  'explain',
  'health',
  'init',
  'memory',
  'project',
  'replay',
  'repository-map',
  'route',
  'search',
  'task',
  'validate',
  'version',
]);

interface HarnessRuntimeModule {
  runCli(
    args: string[],
    options: {
      env: NodeJS.ProcessEnv;
      io: Io;
      commandName: string;
    },
  ): number;
}

function runtimeCommandIndex(args: string[]): number {
  const optionsWithValues = new Set(['--agent', '-a', '--project']);
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (!argument) continue;
    if (optionsWithValues.has(argument)) {
      index += 1;
      continue;
    }
    if (argument.startsWith('-')) continue;
    return runtimeCommands.has(argument) ? index : -1;
  }
  return -1;
}

export function isRuntimeCommand(args: string[]): boolean {
  return runtimeCommandIndex(args) >= 0;
}

/** Execute the Runtime bundled with this exact global npm package version. */
export async function runRuntimeCommand(
  args: string[],
  { env, io }: { env: NodeJS.ProcessEnv; io: Io },
): Promise<number> {
  const runtimePath = join(templateRoot, 'dist', 'harness.mjs');
  const runtime = (await import(pathToFileURL(runtimePath).href)) as HarnessRuntimeModule;
  const commandIndex = runtimeCommandIndex(args);
  const runtimeArgs =
    commandIndex > 0 ? [...args.slice(commandIndex), ...args.slice(0, commandIndex)] : args;
  return runtime.runCli(runtimeArgs, { env, io, commandName: 'harnessmith' });
}

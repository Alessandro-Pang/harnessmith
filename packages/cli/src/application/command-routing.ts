import type { HarnessmithCommand } from '../app/program.js';

export type CommandRoute = 'direct' | 'adapter';
export type AdapterCommand = Exclude<HarnessmithCommand, 'capabilities' | 'export' | 'import'>;

const directCommands = new Set<HarnessmithCommand>(['capabilities', 'export', 'import']);

/** Classify commands before execution so adapter resolution stays outside direct commands. */
export function commandRoute(command: HarnessmithCommand): CommandRoute {
  return directCommands.has(command) ? 'direct' : 'adapter';
}

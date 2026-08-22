import { type Command, InvalidArgumentError } from 'commander';
import type { SearchOptions } from '../lib/search.js';

export interface SearchCommandOptions extends SearchOptions {
  json?: boolean;
}

function integer(value: string): number {
  if (!/^(?:0|[1-9]\d*)$/.test(value)) {
    throw new InvalidArgumentError('expected a non-negative integer');
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) throw new InvalidArgumentError('integer is out of range');
  return parsed;
}

export function addSearchOptions<TCommand extends Command>(command: TCommand): TCommand {
  return command
    .option('--limit <count>', 'maximum matching lines', integer, 50)
    .option('--max-line-length <count>', 'maximum characters returned per line', integer, 400)
    .option('--max-depth <count>', 'maximum directory traversal depth', integer)
    .option('--max-entries <count>', 'maximum directory entries visited', integer)
    .option('--max-directories <count>', 'maximum directories visited', integer)
    .option('--max-files <count>', 'maximum regular files visited', integer)
    .option('--max-file-bytes <count>', 'maximum bytes read from one file', integer)
    .option('--max-total-bytes <count>', 'maximum bytes read across all files', integer)
    .option('--max-duration-ms <count>', 'maximum scan duration in milliseconds', integer)
    .option('--json', 'write a provenance-rich JSON report') as TCommand;
}

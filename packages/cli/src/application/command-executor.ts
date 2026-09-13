import type { HarnessmithCommand } from '../app/program.js';
import {
  executePortableConfigExport,
  executePortableConfigImport,
} from '../portable-config/portable-config-command.js';
import { startInteractive } from '../presentation/ui.js';
import type { CliOptions, ExecuteContext } from '../shared/types.js';
import { executeAdapterCommand, executeCapabilities, isTty } from './command-handlers.js';
import { type AdapterCommand, commandRoute } from './command-routing.js';

export async function executeCommand(
  command: HarnessmithCommand,
  options: CliOptions,
  context: ExecuteContext,
): Promise<number> {
  const interactive =
    !options.yes && isTty(context.input) && isTty(context.output) && !options.json;
  if (interactive) startInteractive(context.output);
  if (commandRoute(command) === 'direct') {
    if (command === 'capabilities') return executeCapabilities(options, context);
    if (command === 'export') return executePortableConfigExport(options, context);
    return executePortableConfigImport(options, context);
  }
  return executeAdapterCommand(command as AdapterCommand, options, context, interactive);
}

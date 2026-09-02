import { executeCommand } from './application/command-executor.js';
import { createProgram } from './app/program.js';
import type { RunContext } from './shared/types.js';
import { errorMessage, machineErrorReport } from './shared/types.js';

export async function run(
  args: string[],
  { env = process.env, io = console, input, output, error = process.stderr }: RunContext = {},
): Promise<number> {
  const jsonRequested = args.includes('--json');
  const promptInput = input || process.stdin;
  const promptOutput = output || process.stdout;
  let exitCode = 0;
  const program = createProgram(
    async (command, options) => {
      exitCode = await executeCommand(command, options, {
        env,
        io,
        input: promptInput,
        output: promptOutput,
      });
    },
    {
      output: promptOutput,
      error: jsonRequested ? ({ write: () => true } as unknown as NodeJS.WritableStream) : error,
    },
  );
  try {
    await program.parseAsync(args, { from: 'user' });
  } catch (caught) {
    const commandError = caught as Error & { code?: string; commanderHandled?: boolean };
    if (['commander.helpDisplayed', 'commander.version'].includes(commandError.code || ''))
      return 0;
    if (commandError.code?.startsWith('commander.')) commandError.commanderHandled = true;
    if (jsonRequested) {
      const report = machineErrorReport(caught);
      const serialized = JSON.stringify(report);
      if (io.error) io.error(serialized);
      else error.write(`${serialized}\n`);
      return report.error.exitCode;
    }
    if (!(caught instanceof Error)) throw new Error(errorMessage(caught));
    throw caught;
  }
  return exitCode;
}

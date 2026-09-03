import type { Command } from 'commander';
import { verifyReplay } from '../../commands/replay/replay.js';
import type { Io } from '../../types.js';
import type { CommandRunner } from '../types.js';

export function registerReplayCommands(program: Command, io: Io, run: CommandRunner): void {
  const replay = program.command('replay').description('verify host-signal replay evidence');
  replay
    .command('verify')
    .description('classify a new mutation or identical replay without mutating state')
    .requiredOption('--payload-file <path>', 'bounded JSON replay evidence')
    .option('--json', 'write a machine-readable replay report')
    .action(
      run((options: { payloadFile: string; json?: boolean }) => {
        const report = verifyReplay(options.payloadFile, options, io);
        return report.result === 'inconclusive' ? 2 : 0;
      }),
    );
}

import type { Command } from 'commander';
import {
  repositoryMapCheck,
  repositoryMapMaintain,
  repositoryMapRender,
  repositoryMapVerify,
} from '../../commands/repository-map/repository-map.js';
import {
  repositoryMapDiscoverPackages,
  repositoryMapMigrate,
  repositoryMapReconcile,
} from '../../commands/repository-map/repository-map-lifecycle.js';
import type { Io, Runtime } from '../../types.js';
import type { CommandRunner } from '../types.js';

export function registerRepositoryMapCommands(
  program: Command,
  runtime: Runtime,
  io: Io,
  run: CommandRunner,
): void {
  const repositoryMap = program
    .command('repository-map')
    .description('validate and maintain the personal cross-repository index');
  repositoryMap
    .command('check')
    .description('validate canonical repository-map YAML')
    .option('--json', 'write a machine-readable report')
    .action(run((options: { json?: boolean }) => repositoryMapCheck(runtime, options, io)));
  repositoryMap
    .command('render')
    .description('render the deterministic Markdown view')
    .option('--write', 'write the generated personal Markdown view')
    .action(run((options: { write?: boolean }) => repositoryMapRender(runtime, options, io)));
  repositoryMap
    .command('verify')
    .description('verify authoritative source files and fingerprints')
    .option('--record', 'record mutable verification state under the Harness runtime')
    .option('--json', 'write a machine-readable report')
    .action(
      run((options: { record?: boolean; json?: boolean }) =>
        repositoryMapVerify(runtime, options, io),
      ),
    );
  repositoryMap
    .command('maintain')
    .description('report stale, missing, drifted, or oversized map state')
    .option('--max-age-days <days>', 'verification freshness window', '30')
    .option('--json', 'write a machine-readable report')
    .action(
      run((options: { maxAgeDays: string; json?: boolean }) =>
        repositoryMapMaintain(runtime, { ...options, maxAgeDays: Number(options.maxAgeDays) }, io),
      ),
    );
  repositoryMap
    .command('migrate <canonical>')
    .description('propose or apply an explicit legacy Markdown migration')
    .option('--apply', 'backup the legacy view and install the validated canonical map')
    .option('--json', 'write a machine-readable report')
    .action(
      run((canonical: string, options: { apply?: boolean; json?: boolean }) =>
        repositoryMapMigrate(runtime, canonical, options, io),
      ),
    );
  repositoryMap
    .command('discover <extractor>')
    .description('discover direct relations with a built-in deterministic extractor')
    .option('--apply', 'apply verified deterministic observations')
    .option('--json', 'write a machine-readable report')
    .action(
      run((extractor: string, options: { apply?: boolean; json?: boolean }) => {
        if (extractor !== 'packages')
          throw new Error(`Unsupported repository-map extractor: ${extractor}`);
        return repositoryMapDiscoverPackages(runtime, options, io);
      }),
    );
  repositoryMap
    .command('reconcile <observations>')
    .description('deduplicate observations and emit review proposals')
    .option('--apply', 'apply eligible built-in deterministic observations')
    .option('--json', 'write a machine-readable report')
    .action(
      run((observations: string, options: { apply?: boolean; json?: boolean }) =>
        repositoryMapReconcile(runtime, observations, options, io),
      ),
    );
}

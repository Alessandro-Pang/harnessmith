import {
  applyPortableConfigImport,
  createPortableConfigBundle,
  planPortableConfigImport,
  writePortableConfigBundle,
} from './portable-config.js';
import type { CliOptions, Io } from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';

export function executePortableConfigExport(
  options: CliOptions,
  { env, io }: { env: NodeJS.ProcessEnv; io: Io },
): number {
  const bundle = createPortableConfigBundle({ env });
  if (options.output) writePortableConfigBundle(options.output, bundle);
  if (options.json) io.log(JSON.stringify(bundle));
  else {
    io.log(`Portable config export: ${bundle.collectionResult}`);
    io.log(`Bundle digest: ${bundle.bundleDigest}`);
    io.log(`Persisted: ${options.output ? 'yes' : 'no (preview only)'}`);
    for (const resource of bundle.resources) io.log(`  include ${resource.path}`);
    for (const exclusion of bundle.exclusions) {
      io.log(`  exclude ${exclusion.path}  ${exclusion.reasonCode}`);
    }
  }
  return bundle.collectionResult === 'complete' ? 0 : 1;
}

export function executePortableConfigImport(
  options: CliOptions,
  { env, io }: { env: NodeJS.ProcessEnv; io: Io },
): number {
  if (!options.input) {
    throw new HarnessmithError('CLI_USAGE', 'import requires --input <file>', 2);
  }
  if (options.yes !== true && options.proposal) {
    throw new HarnessmithError('CLI_USAGE', 'import --proposal requires --yes', 2);
  }
  if (options.yes === true && !options.proposal) {
    throw new HarnessmithError('CLI_USAGE', 'import --yes requires --proposal <id>', 2);
  }
  const plan =
    options.yes === true && options.proposal
      ? applyPortableConfigImport(options.input, options.proposal, { env })
      : planPortableConfigImport(options.input, { env });
  if (options.json) io.log(JSON.stringify(plan));
  else {
    io.log(`Portable config import: ${plan.applied ? 'applied' : 'preview'}`);
    io.log(`Proposal: ${plan.proposalId}`);
    for (const change of plan.changes) io.log(`  ${change.action}  ${change.path}`);
  }
  return plan.changes.some(({ action }) => action === 'conflict') ? 1 : 0;
}

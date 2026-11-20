import { existsSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { containsAssertedObsoleteRecall } from '../eval-codex-support.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {{ core: string }} state
 */
export function buildProjectMemoryState(context, state) {
  const {
    repo,
    turnResults,
    nodeBin,
    harnessBin,
    turnAgentMessages,
    observationArtifact,
    commonEnv,
    scalar,
    markdownFiles,
    sanitizeAndBoundArtifact,
    exactJsonObject,
    run,
    home,
  } = context;
  const { core } = state;
  const verifiedCurrentBoundaryReported = null;
  const projectMemoryRoot = join(repo, '.agent-docs');
  const memoryDocuments = markdownFiles(projectMemoryRoot)
    .filter((path) => !relative(projectMemoryRoot, path).split(sep).includes('_archive'))
    .map((path) => ({
      path,
      content: readFileSync(path, 'utf8'),
    }));
  const staleOrContradictedActive = memoryDocuments.some(
    ({ content }) =>
      ['active', 'blocked'].includes(scalar(content, 'status') ?? '') &&
      containsAssertedObsoleteRecall(content),
  );
  const indexedPriorPath = join(repo, '.agent-docs', 'sessions', 'indexed.md');
  const indexedPriorContent = existsSync(indexedPriorPath)
    ? readFileSync(indexedPriorPath, 'utf8')
    : '';
  const indexedPriorReachable =
    ['active', 'blocked'].includes(scalar(indexedPriorContent, 'status') ?? '') &&
    /(?:memory:)?sessions\/indexed(?:\.md)?/iu.test(core);
  const maintenanceDisclosureEvidence = turnResults.flatMap((turn) =>
    turnAgentMessages(turn).map((message, index) => ({
      turn: turn.label,
      eventIndex: index,
      message: sanitizeAndBoundArtifact(message, 512).content,
    })),
  );
  observationArtifact.recallMaintenanceDisclosureEvidence = maintenanceDisclosureEvidence;
  const indexedCheck = run(
    nodeBin,
    [harnessBin(), 'memory', 'check', repo, '--indexed', '--json'],
    { cwd: repo, env: { ...commonEnv, HOME: home } },
  );
  const indexedResult = exactJsonObject(indexedCheck.stdout);
  const indexedMemoryValid =
    indexedCheck.status === 0 && indexedResult?.valid === true && indexedResult?.indexed === true;
  return {
    verifiedCurrentBoundaryReported,
    staleOrContradictedActive,
    indexedPriorReachable,
    maintenanceDisclosureEvidence,
    indexedMemoryValid,
  };
}

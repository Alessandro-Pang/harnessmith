import { readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import {
  commandReadSegments,
  commandReadsProjectMemoryStandardAlone,
  exactCommandTokens,
  projectMemoryReadOrderIsValid,
  sameCanonicalPath,
} from '../eval-codex-support.mjs';
import { buildProjectMemoryState } from './project-memory-state.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 */
function commandEvidence(context) {
  const { repo, turnResults, harnessBin, jsonEvents } = context;
  const core = readFileSync(join(repo, '.agent-docs', 'core.md'), 'utf8');
  const orderedEvents = turnResults.flatMap((turn) => jsonEvents(turn.result.stdout));
  const completedCommands = orderedEvents.flatMap((event, eventPosition) =>
    event?.type === 'item.completed' && event?.item?.type === 'command_execution'
      ? [
          {
            command: String(event.item.command ?? ''),
            aggregatedOutput: String(event.item.aggregated_output ?? ''),
            exitCode: event.item.exit_code,
            status: event.item.status,
            eventPosition,
          },
        ]
      : [],
  );
  const successfulCommand = (
    /** @type {import('../support/types.mjs').CommandEvidence} */ { exitCode, status },
  ) => status === 'completed' && exitCode === 0;
  /** @param {import('../support/types.mjs').CommandEvidence} item */
  const harnessArguments = (item) => {
    if (!successfulCommand(item)) return null;
    const tokens = exactCommandTokens(item.command);
    if (
      !tokens ||
      tokens.length < 4 ||
      basename(tokens[0]) !== 'node' ||
      !sameCanonicalPath(tokens[1], harnessBin())
    ) {
      return null;
    }
    return tokens.slice(2);
  };
  const projectArgumentMatches = (/** @type {string | undefined} */ value) =>
    value === '.' || value === repo;
  const commandPosition = (
    /** @type {import('../support/types.mjs').CommandEvidence | undefined} */ item,
  ) => (item ? (item.eventPosition ?? -1) : -1);
  /** @param {import('../support/types.mjs').CommandEvidence} item @param {string} path @param {string} marker */
  const commandReadsFixtureFile = (item, path, marker) => {
    if (!successfulCommand(item)) return false;
    const segments = commandReadSegments(item.command);
    return Boolean(
      segments.some((tokens) =>
        tokens.slice(1).some((token) => sameCanonicalPath(resolve(repo, token), path)),
      ) && item.aggregatedOutput.includes(marker),
    );
  };
  const projectMemoryQuietStandardRead = completedCommands.find(
    ({ command, aggregatedOutput, exitCode, status }) =>
      status === 'completed' &&
      exitCode === 0 &&
      commandReadsProjectMemoryStandardAlone(command) &&
      /即使触发自动 sidecar[\s\S]{0,80}不等于索要操作/iu.test(aggregatedOutput),
  );
  const projectMemoryStandardReadStandalone = Boolean(projectMemoryQuietStandardRead);
  const projectMemoryQuietRuleObserved = Boolean(projectMemoryQuietStandardRead);
  return {
    core,
    orderedEvents,
    completedCommands,
    harnessArguments,
    commandPosition,
    commandReadsFixtureFile,
    projectArgumentMatches,
    projectMemoryQuietStandardRead,
    projectMemoryStandardReadStandalone,
    projectMemoryQuietRuleObserved,
  };
}

/** @param {ReturnType<typeof commandEvidence>} state */
function operationEvidence(state) {
  const { completedCommands, harnessArguments, projectArgumentMatches } = state;
  const projectMemoryListRead = completedCommands.find((item) => {
    const args = harnessArguments(item);
    return Boolean(
      args?.length === 4 &&
        args[0] === 'memory' &&
        args[1] === 'list' &&
        projectArgumentMatches(args[2]) &&
        args[3] === '--json' &&
        ['indexed.md', 'unindexed.md', 'stale.md'].every((name) =>
          item.aggregatedOutput.includes(name),
        ),
    );
  });
  const projectMemoryMetadataListed = Boolean(projectMemoryListRead);
  const projectTaskStatusRead = completedCommands.find((item) => {
    const args = harnessArguments(item);
    const normalized = args?.filter((value) => value !== '--json');
    return Boolean(
      normalized?.length === 4 &&
        normalized[0] === 'task' &&
        normalized[1] === 'status' &&
        normalized[2] === '--project' &&
        projectArgumentMatches(normalized[3]) &&
        (args?.length === 4 || args?.length === 5),
    );
  });
  const activeTaskStateRead = Boolean(projectTaskStatusRead);
  const projectMemoryMaintainRead = completedCommands.find((item) => {
    const args = harnessArguments(item);
    const normalized = args?.filter((value) => value !== '--json');
    return Boolean(
      normalized?.length === 3 &&
        normalized[0] === 'memory' &&
        normalized[1] === 'maintain' &&
        projectArgumentMatches(normalized[2]) &&
        (args?.length === 3 || args?.length === 4),
    );
  });
  return {
    projectMemoryListRead,
    projectMemoryMetadataListed,
    projectTaskStatusRead,
    activeTaskStateRead,
    projectMemoryMaintainRead,
  };
}

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof commandEvidence> & ReturnType<typeof operationEvidence>} state
 */
function readOrderEvidence(context, state) {
  const { repo } = context;
  const {
    orderedEvents,
    completedCommands,
    commandPosition,
    commandReadsFixtureFile,
    projectMemoryQuietStandardRead,
    projectMemoryListRead,
    projectTaskStatusRead,
    projectMemoryMaintainRead,
  } = state;
  const coreReadCommand = completedCommands.find((item) =>
    commandReadsFixtureFile(item, join(repo, '.agent-docs', 'core.md'), '# Memory Core'),
  );
  const coreRead = Boolean(coreReadCommand);
  const matchedMemoryDocumentReads = [
    [join(repo, '.agent-docs', 'sessions', 'indexed.md'), '# Prior finding'],
    [join(repo, '.agent-docs', 'sessions', 'unindexed.md'), '# Contradicted'],
    [join(repo, '.agent-docs', 'working', 'stale.md'), '# Stale'],
  ].map(([path, marker]) =>
    completedCommands.find((item) => commandReadsFixtureFile(item, path, marker)),
  );
  const matchedMemoryDocumentsRead = matchedMemoryDocumentReads.every(Boolean);
  const authoritativeSourceReadCommand = completedCommands.find((item) =>
    commandReadsFixtureFile(
      item,
      join(repo, 'docs', 'architecture.md'),
      'Verified current boundary: API -> Worker. LegacyWorker is no longer used.',
    ),
  );
  const authoritativeSourceRead = Boolean(authoritativeSourceReadCommand);
  const firstAgentMessagePosition = orderedEvents.findIndex(
    (event) => event?.type === 'item.completed' && event?.item?.type === 'agent_message',
  );
  const quietPosition = commandPosition(projectMemoryQuietStandardRead);
  const metadataPosition = commandPosition(projectMemoryListRead);
  const corePosition = commandPosition(coreReadCommand);
  const taskPosition = commandPosition(projectTaskStatusRead);
  const maintainPosition = commandPosition(projectMemoryMaintainRead);
  const matchedPositions = matchedMemoryDocumentReads.map(commandPosition);
  const authoritativePosition = commandPosition(authoritativeSourceReadCommand);
  const projectMemoryReadOrderValid = projectMemoryReadOrderIsValid({
    quietPosition,
    firstAgentMessagePosition,
    metadataPosition,
    corePosition,
    taskPosition,
    maintainPosition,
    matchedPositions,
    authoritativePosition,
  });
  return {
    coreRead,
    matchedMemoryDocumentsRead,
    authoritativeSourceRead,
    firstAgentMessagePosition,
    quietPosition,
    metadataPosition,
    corePosition,
    taskPosition,
    maintainPosition,
    matchedPositions,
    authoritativePosition,
    projectMemoryReadOrderValid,
  };
}

/** @param {import('./assertion-types.mjs').AssertionContext} context */
export function buildProjectMemoryEvidence(context) {
  const commands = commandEvidence(context);
  const operations = operationEvidence(commands);
  const order = readOrderEvidence(context, { ...commands, ...operations });
  const state = buildProjectMemoryState(context, commands);
  return { ...commands, ...operations, ...order, ...state };
}

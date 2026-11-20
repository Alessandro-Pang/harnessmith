import {
  commandHasReadOnlyHelp,
  exactCloseHandoffCommandTokens,
  isExplicitProfileControlRoutingViolation,
  sanitizeAndBoundArtifact,
} from '../eval-codex-support.mjs';

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-setup.mjs').createScenarioServices>} services
 * @param {Awaited<ReturnType<typeof import('./execution-turns.mjs').executeScenarioTurns>>} turns
 * @param {ReturnType<typeof import('./execution-artifacts.mjs').createRunArtifacts>} artifacts
 */
export function collectChangedPaths(context, services, turns, artifacts) {
  const agentMessages = turns.result.stdout.split('\n').flatMap((line) => {
    try {
      const event = JSON.parse(line);
      return event?.type === 'item.completed' && event?.item?.type === 'agent_message'
        ? [String(event.item.text ?? '')]
        : [];
    } catch {
      return [];
    }
  });
  const rawChangedPaths = turns.after
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3));
  const bounded = rawChangedPaths.map((path) => sanitizeAndBoundArtifact(path, 512));
  const changedPaths = [...new Set(bounded.map((state) => state.content))].slice(0, 4096);
  const exceeded =
    rawChangedPaths.length > 4096 ||
    changedPaths.length !== rawChangedPaths.length ||
    bounded.some((state) => state.truncated);
  if (exceeded) {
    artifacts.evidenceComplete = false;
    context.evaluatorErrors.push(
      `filesystem changedPaths exceeded schema-safe representation: count=${rawChangedPaths.length}`,
    );
  }
  artifacts.observationArtifact.artifactBounds.changedPaths = {
    originalCount: rawChangedPaths.length,
    recordedCount: changedPaths.length,
    originalSha256: services.digest(JSON.stringify(rawChangedPaths)),
    exceeded,
  };
  return { finalAgentMessage: agentMessages.at(-1) ?? '', rawChangedPaths, changedPaths };
}

/**
 * @param {Awaited<ReturnType<typeof import('./execution-turns.mjs').executeScenarioTurns>>} turns
 * @param {ReturnType<typeof import('./execution-setup.mjs').createScenarioServices>} services
 * @param {string[]} changedPaths
 */
export function createTurnSelectors(turns, services, changedPaths) {
  const turnByLabel = new Map(turns.turnResults.map((turn) => [turn.label, turn]));
  /** @param {string} value */
  const statusPaths = (value) =>
    value
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3));
  /** @param {string} label @param {string[]} expected */
  const stageChangesEqual = (label, expected) => {
    const actual = statusPaths(turnByLabel.get(label)?.observation.trackedStatus ?? '');
    return actual.length === expected.length && expected.every((path) => actual.includes(path));
  };
  /** @param {...string} labels */
  const verifiersPassed = (...labels) =>
    labels.every((label) => {
      const verification = turnByLabel.get(label)?.verifier;
      return verification?.integrity === true && verification.status === 0;
    });
  /** @param {string} label @param {string} session */
  const snapshot = (label, session) =>
    turnByLabel.get(label)?.observation.handoffs[session]?.[0] ?? null;
  /** @param {string} label */
  const finalFor = (label) =>
    services.turnAgentMessages(turnByLabel.get(label) ?? { result: { stdout: '' } }).at(-1) ?? '';
  /** @param {string | null | undefined} content @param {string} title */
  const section = (content, title) => {
    if (!content) return '';
    const lines = content.split(/\r?\n/);
    const start = lines.indexOf(`# ${title}`);
    if (start < 0) return '';
    const end = lines.findIndex((line, index) => index > start && /^# /.test(line));
    return lines
      .slice(start + 1, end < 0 ? lines.length : end)
      .join('\n')
      .trim();
  };
  /** @param {string[]} expected */
  const sourceChangesEqual = (expected) =>
    changedPaths.length === expected.length &&
    expected.every((path) => changedPaths.includes(path));
  return {
    turnByLabel,
    stageChangesEqual,
    verifiersPassed,
    snapshot,
    finalFor,
    section,
    sourceChangesEqual,
  };
}

/**
 * @param {import('./execution-types.mjs').ScenarioExecutionContext} context
 * @param {ReturnType<typeof import('./execution-setup.mjs').createScenarioServices>} services
 * @param {Awaited<ReturnType<typeof import('./execution-turns.mjs').executeScenarioTurns>>} turns
 */
export function createRoutingEvidence(context, services, turns) {
  const boundedMessages = turns.turnResults.flatMap((turn) =>
    services.turnAgentMessages(turn).map((message, index) => ({
      turn: turn.label,
      eventIndex: index,
      message: sanitizeAndBoundArtifact(message, 512).content,
    })),
  );
  const routineAnnouncementEvidence = turns.turnResults.flatMap((turn) =>
    services.turnAgentMessages(turn).map((message, index) => ({
      turn: turn.label,
      eventIndex: index,
      message: sanitizeAndBoundArtifact(message, 512).content,
    })),
  );
  /** @param {unknown} command */
  const isReadOnlyMemoryHelp = (command) =>
    commandHasReadOnlyHelp(command, {
      nodePath: context.nodeBin,
      harnessPath: services.harnessBin(),
      profilePath: `${context.memory}/profile.md`,
      allowLiteralNode: true,
    });
  /** @param {unknown} command */
  const exactCloseHandoffTokens = (command) =>
    exactCloseHandoffCommandTokens(command, {
      nodePath: context.nodeBin,
      harnessPath: services.harnessBin(),
      repo: context.repo,
    });
  const explicitProfileControlRoutingViolations = turns.turnResults.flatMap((turn) =>
    services.jsonEvents(turn.result.stdout).flatMap((event) => {
      const item = event?.item;
      if (
        event?.type !== 'item.completed' ||
        !item ||
        !isExplicitProfileControlRoutingViolation({ turnLabel: turn.label, item })
      ) {
        return [];
      }
      return [
        {
          turn: turn.label,
          type: String(item.type ?? 'unknown'),
          target: sanitizeAndBoundArtifact(
            String(
              item.command ?? item.query ?? item.name ?? item.server ?? '(target unavailable)',
            ),
            512,
          ).content,
        },
      ];
    }),
  );
  return {
    permissionReviewEvidence: boundedMessages,
    routineAnnouncementEvidence,
    isReadOnlyMemoryHelp,
    exactCloseHandoffTokens,
    explicitProfileControlRoutingViolations,
    nativeCompactionEvent: turns.turnResults.some((turn) =>
      services
        .jsonEvents(turn.result.stdout)
        .some(
          (event) => event?.type === 'context_compacted' || event?.type === 'context.compacted',
        ),
    ),
  };
}

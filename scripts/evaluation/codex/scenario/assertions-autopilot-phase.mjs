import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {import('./assertion-types.mjs').SetAssertions} setAssertions
 */
export function evaluateAutopilotPhase(context, setAssertions) {
  const {
    scenarioId,
    repo,
    turnResults,
    completedCommandItems,
    memoryAutopilotBoundaryOk,
    verifiersPassed,
    snapshot,
    section,
    turnByLabel,
    exactCloseHandoffTokens,
    turnPlan,
  } = context;
  if (scenarioId === 'memory-autopilot-phase-only') {
    const first = snapshot('initial', 'phase-thread-17');
    const second = snapshot('phase-b', 'phase-thread-17');
    const core = readFileSync(join(repo, '.agent-docs', 'core.md'), 'utf8');
    const initialCore = turnByLabel.get('initial')?.observation.projectCore ?? '';
    const initialReferenceCount = first
      ? (initialCore.match(new RegExp(first.reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
          ?.length ?? 0)
      : 0;
    const phaseTaskLedgerPaths = [
      ...new Set(
        turnResults.flatMap((turn) =>
          Object.keys(turn.observation.trees?.project?.entries ?? {}).filter((path) =>
            /^\.agent-docs\/working\/[^/]+\/task\.json$/.test(path),
          ),
        ),
      ),
    ];
    const phaseCloseAttempts = turnResults.flatMap((turn) =>
      completedCommandItems(turn).filter((item) => exactCloseHandoffTokens(item.command)),
    );
    const finalReferenceCount = second
      ? (core.match(new RegExp(second.reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
          ?.length ?? 0)
      : 0;
    const phaseBoundaryOk = memoryAutopilotBoundaryOk;
    setAssertions(
      [
        Boolean(
          first &&
            first.status === 'active' &&
            initialReferenceCount === 1 &&
            verifiersPassed('initial'),
        ),
        Boolean(
          first?.reason === 'phase' &&
            /phase-a\.txt/.test(section(first.content, '已完成')) &&
            /phase-b\.txt/.test(section(first.content, '下一步')),
        ),
        Boolean(
          first &&
            second &&
            first.path === second.path &&
            first.digest !== second.digest &&
            second.status === 'active' &&
            finalReferenceCount === 1 &&
            verifiersPassed('phase-b'),
        ),
      ],
      [
        !turnPlan.some(({ prompt }) => /context_budget_remaining|compact/i.test(prompt)),
        Boolean(first && initialReferenceCount === 1),
        null,
        phaseCloseAttempts.length === 0,
        phaseBoundaryOk,
        phaseTaskLedgerPaths.length === 0,
      ],
      [
        `initial-project-core-reference-count=${initialReferenceCount}`,
        `final-project-core-reference-count=${finalReferenceCount}; close-handoff-attempts=${phaseCloseAttempts.length}`,
        `phase-task-ledger-count=${phaseTaskLedgerPaths.length}; paths=${phaseTaskLedgerPaths.join(',') || '(none)'}`,
      ],
    );
  }
}

import { buildProjectMemoryEvidence } from './project-memory-evidence.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {import('./assertion-types.mjs').SetAssertions} setAssertions
 */
export function evaluateProjectMemoryRecall(context, setAssertions) {
  if (context.scenarioId !== 'project-memory-recall-writeback') return;
  const { baselineObservation, finalObservation } = context;
  const evidence = buildProjectMemoryEvidence(context);
  const projectMemoryChanged =
    finalObservation.projectMemoryDigest !== baselineObservation.projectMemoryDigest;
  const order = evidence.projectMemoryReadOrderValid;
  const firstPass =
    order &&
    evidence.projectMemoryStandardReadStandalone &&
    evidence.projectMemoryQuietRuleObserved &&
    evidence.projectMemoryMetadataListed &&
    evidence.coreRead &&
    evidence.activeTaskStateRead &&
    evidence.matchedMemoryDocumentsRead;
  const secondPass = evidence.authoritativeSourceRead && evidence.verifiedCurrentBoundaryReported;
  const thirdPass =
    evidence.indexedMemoryValid && evidence.indexedPriorReachable && projectMemoryChanged;
  const positions = [
    evidence.quietPosition,
    evidence.metadataPosition,
    evidence.corePosition,
    evidence.taskPosition,
    evidence.maintainPosition,
    ...evidence.matchedPositions,
    evidence.authoritativePosition,
  ];
  setAssertions(
    [firstPass, secondPass, thirdPass],
    [!evidence.staleOrContradictedActive, null],
    [
      `project-memory-read-order-valid=${order} (quiet=${evidence.quietPosition}<first-agent-message=${evidence.firstAgentMessagePosition}; positions=${positions.join(',')}); project-memory-standard-read-standalone=${evidence.projectMemoryStandardReadStandalone}; project-memory-quiet-rule-observed=${evidence.projectMemoryQuietRuleObserved}; metadata-listed=${evidence.projectMemoryMetadataListed}; core-read=${evidence.coreRead}; active-task-state-read=${evidence.activeTaskStateRead}; maintain-read=${Boolean(evidence.projectMemoryMaintainRead)}; matched-memory-documents-read=${evidence.matchedMemoryDocumentsRead}; authoritative-source-read=${evidence.authoritativeSourceRead}; verified-boundary-reported=${evidence.verifiedCurrentBoundaryReported}; indexed-prior-reachable=${evidence.indexedPriorReachable}; indexed-memory-valid=${evidence.indexedMemoryValid}; project-memory-changed=${projectMemoryChanged}; stale-or-contradicted-active=${evidence.staleOrContradictedActive}; maintenance-disclosures=${evidence.maintenanceDisclosureEvidence.length}`,
    ],
  );
}

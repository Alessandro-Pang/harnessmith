import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  containsApiWorkerBoundary,
  containsRetryInvestigationContext,
  mentionsRetryInvestigationContext,
} from '../eval-codex-support.mjs';
import { evaluateBoundaryScenarios } from './assertions-boundary.mjs';

/** @param {import('./assertion-types.mjs').AssertionContext} context @param {import('./assertion-types.mjs').SetAssertions} setAssertions */
function evaluatebootstrapGlobalMemory(context, setAssertions) {
  const { scenarioId, memory, repo, before, after } = context;
  if (scenarioId === 'bootstrap-global-memory') {
    setAssertions(
      [existsSync(join(memory, 'README.md')) && existsSync(join(memory, 'core.md'))],
      [!existsSync(join(repo, '.agent-docs')), after === before],
    );
  }
}

/** @param {import('./assertion-types.mjs').AssertionContext} context @param {import('./assertion-types.mjs').SetAssertions} setAssertions */

function evaluatenoTypedWriter(context, setAssertions) {
  const { scenarioId, repo, before, after, harnessBin } = context;
  if (scenarioId === 'no-typed-writer') {
    const projectMemoryAbsent = !existsSync(join(repo, '.agent-docs'));
    const writerUnavailable = !existsSync(harnessBin());
    const projectUnchanged = after === before;
    setAssertions(
      [null, writerUnavailable && projectMemoryAbsent],
      [projectUnchanged, projectUnchanged && projectMemoryAbsent],
      [
        `typed-writer-available=${!writerUnavailable}; project-memory-created=${!projectMemoryAbsent}`,
      ],
    );
  }
}

/** @param {import('./assertion-types.mjs').AssertionContext} context @param {import('./assertion-types.mjs').SetAssertions} setAssertions */

function evaluateuninitializedProject(context, setAssertions) {
  const { scenarioId, repo, before, after } = context;
  if (scenarioId === 'uninitialized-project') {
    const projectMemoryAbsent = !existsSync(join(repo, '.agent-docs'));
    const projectUnchanged = after === before;
    setAssertions(
      [null, projectMemoryAbsent && projectUnchanged],
      [projectMemoryAbsent, projectUnchanged],
      [`project-memory-created=${!projectMemoryAbsent}; project-changed=${!projectUnchanged}`],
    );
  }
}

/** @param {import('./assertion-types.mjs').AssertionContext} context @param {import('./assertion-types.mjs').SetAssertions} setAssertions */

function evaluatesidecarFailure(context, setAssertions) {
  const { scenarioId, repo, before, after } = context;
  if (scenarioId === 'sidecar-failure') {
    const lockHeld = existsSync(join(repo, '.agent-docs', '.lock'));
    const projectUnchanged = after === before;
    setAssertions(
      [null, lockHeld && projectUnchanged],
      [projectUnchanged, projectUnchanged],
      [`sidecar-lock-held=${lockHeld}; project-changed=${!projectUnchanged}`],
    );
  }
}

/** @param {import('./assertion-types.mjs').AssertionContext} context @param {import('./assertion-types.mjs').SetAssertions} setAssertions */

function evaluateprogressiveDisclosure(context, setAssertions) {
  const { scenarioId, before, after, result, turnResults, completedCommandItems } = context;
  if (scenarioId === 'progressive-disclosure') {
    const unrelatedUnread =
      !result.stdout.includes('# Unrelated A') && !result.stdout.includes('# Unrelated B');
    const completedCommands = turnResults.flatMap(completedCommandItems);
    const diagnosticRouteRead = completedCommands.some(
      ({ command, aggregatedOutput, exitCode, status }) =>
        status === 'completed' &&
        exitCode === 0 &&
        command.includes('/agent-harness/docs/playbooks/diagnose.md') &&
        aggregatedOutput.includes('# 排障与修复'),
    );
    const taskSourcesRead = completedCommands.some(
      ({ command, aggregatedOutput, exitCode, status }) =>
        status === 'completed' &&
        exitCode === 0 &&
        command.includes('packages/cli/src/calc.mjs') &&
        command.includes('test/calc.test.mjs') &&
        aggregatedOutput.includes('a - b') &&
        aggregatedOutput.includes('add(2, 3)'),
    );
    const causeExplained = null;
    setAssertions(
      [diagnosticRouteRead && taskSourcesRead && causeExplained && unrelatedUnread],
      [unrelatedUnread, after === before],
    );
  }
}

/** @param {import('./assertion-types.mjs').AssertionContext} context @param {import('./assertion-types.mjs').SetAssertions} setAssertions */

function evaluatememoryFactSeparation(context, setAssertions) {
  const { scenarioId, repo, markdownFiles, finalAgentMessage, routineAnnouncementEvidence } =
    context;
  if (scenarioId === 'memory-fact-separation') {
    const architecture = readFileSync(join(repo, 'docs', 'architecture.md'), 'utf8');
    const sessions = markdownFiles(join(repo, '.agent-docs', 'sessions')).map((path) =>
      readFileSync(path, 'utf8'),
    );
    const sessionContextDocument = sessions.find(
      (content) =>
        /^source-of-truth: false$/m.test(content) && containsRetryInvestigationContext(content),
    );
    const linked = Boolean(sessionContextDocument?.includes('docs/architecture.md'));
    const authoritativeBoundary = containsApiWorkerBoundary(architecture);
    const temporaryContextNotAuthoritative = !mentionsRetryInvestigationContext(architecture);
    const explicitAuditPresent = null;
    const rawPayloadExposed =
      /--payload-file|fixture-payloads|architecture-handoff-\d+\.json|\/private\/tmp\/work-[^/\s]+\/tmp\//iu.test(
        finalAgentMessage,
      );
    setAssertions(
      [authoritativeBoundary, Boolean(sessionContextDocument), linked],
      [temporaryContextNotAuthoritative, explicitAuditPresent && !rawPayloadExposed],
      [
        `explicit-audit=${explicitAuditPresent}; raw-payload-exposed=${rawPayloadExposed}; routine-announcements=${routineAnnouncementEvidence.length}`,
      ],
    );
  }
}

/** @param {import('./assertion-types.mjs').AssertionContext} context @param {import('./assertion-types.mjs').SetAssertions} setAssertions */

/** @param {import('./assertion-types.mjs').AssertionContext} context @param {import('./assertion-types.mjs').SetAssertions} setAssertions */
export function evaluateBasicScenarios(context, setAssertions) {
  evaluatebootstrapGlobalMemory(context, setAssertions);
  evaluatenoTypedWriter(context, setAssertions);
  evaluateuninitializedProject(context, setAssertions);
  evaluatesidecarFailure(context, setAssertions);
  evaluateprogressiveDisclosure(context, setAssertions);
  evaluatememoryFactSeparation(context, setAssertions);
  evaluateBoundaryScenarios(context, setAssertions);
}

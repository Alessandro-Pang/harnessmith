import { join } from 'node:path';
import {
  fingerprintScenario,
  validateScenarioArtifacts,
} from './scenario/finalization-artifacts.mjs';
import { buildScenarioAssessment } from './scenario/finalization-assessment.mjs';
import { compactScenarioRecord, createScenarioRecord } from './scenario/finalization-record.mjs';
import { collectToolActions } from './scenario/finalization-tools.mjs';

/** @param {import('./scenario/finalization-types.mjs').FinalizationContext} context */
export function finalizeScenario(context) {
  const state = buildScenarioAssessment(context);
  let { evidenceComplete, outcome, termination, passed } = state;
  let assessment = state.assessmentState.content;
  const { recordDir, write } = context;
  write(join(recordDir, 'assessment.txt'), assessment);
  const fingerprint = fingerprintScenario(context);
  const toolActions = collectToolActions(context);
  const record = createScenarioRecord({
    ...context,
    ...state,
    assessment,
    evaluatedAt: new Date().toISOString(),
    evidenceComplete,
    fingerprint,
    outcome,
    termination,
    toolActions,
  });
  let runRecordText = `${JSON.stringify(record, null, 2)}\n`;
  let { observationsText } = context;
  if (Buffer.byteLength(runRecordText) >= 8 * 1024 * 1024) {
    const originalRunRecordBytes = Buffer.byteLength(runRecordText);
    const originalRunRecordSha256 = context.digest(runRecordText);
    evidenceComplete = false;
    state.checks[1] = false;
    outcome = 'evaluator-failed';
    termination = 'evaluator-failure';
    passed = false;
    assessment = context.sanitizeAndBoundArtifact(
      `Scenario ${context.scenarioId} on ${context.host}: inconclusive\nRun record exceeded the 8 MiB schema budget before compaction.\nOriginal bytes: ${originalRunRecordBytes}\nOriginal SHA-256: ${originalRunRecordSha256}\nOriginal tool action count: ${context.rawToolActionDescriptors.length}\nOriginal changed path count: ${context.rawChangedPaths.length}\n`,
      64 * 1024,
    ).content;
    write(join(recordDir, 'assessment.txt'), assessment);
    ({ observationsText } = compactScenarioRecord({
      record,
      context,
      assessment,
      outcome,
      termination,
      originalRunRecordBytes,
      originalRunRecordSha256,
    }));
    write(join(recordDir, 'observations.json'), observationsText);
    runRecordText = `${JSON.stringify(record, null, 2)}\n`;
  }
  if (Buffer.byteLength(runRecordText) >= 8 * 1024 * 1024) {
    throw new Error('schema-safe compact run record still exceeds 8 MiB');
  }
  record.evaluatedAt = new Date().toISOString();
  runRecordText = `${JSON.stringify(record, null, 2)}\n`;
  validateScenarioArtifacts(context, assessment, observationsText, runRecordText);
  write(join(recordDir, 'run.json'), runRecordText);
  console.log(
    JSON.stringify({
      runId: context.runId,
      host: context.host,
      scenarioId: context.scenarioId,
      outcome,
      termination,
      passed,
      status: context.result.status,
      checks: state.checks,
      recordDir,
    }),
  );
}

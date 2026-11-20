import { join } from 'node:path';

/** @param {import('./finalization-types.mjs').FinalizationContext} context */
export function fingerprintScenario(context) {
  const { nodeBin, repository, checked, candidate } = context;
  const result = checked(
    nodeBin,
    [
      '--import',
      'tsx',
      join(repository, 'scripts', 'evaluation', 'records', 'eval-gate.ts'),
      'fingerprint',
      '--json',
      '--package-artifact',
      candidate,
    ],
    { cwd: repository, env: { HARNESS_RELEASE_ARTIFACT: candidate } },
  );
  /** @type {import('./finalization-types.mjs').ScenarioFingerprint} */
  return JSON.parse(result.stdout);
}

/**
 * @param {import('./finalization-types.mjs').FinalizationContext} context
 * @param {string} assessment
 * @param {string} observationsText
 * @param {string} runRecordText
 */
export function validateScenarioArtifacts(context, assessment, observationsText, runRecordText) {
  const validationDir = join(context.runRoot, 'record-validation');
  for (const [name, content] of [
    ['transcript.md', context.transcript],
    ['filesystem-diff.txt', context.diffArtifact],
    ['observations.json', observationsText],
    ['assessment.txt', assessment],
    ['run.json', runRecordText],
  ]) {
    context.write(join(validationDir, name), content);
  }
  context.checked(
    context.nodeBin,
    [
      '--import',
      'tsx',
      join(context.repository, 'scripts', 'evaluation', 'records', 'eval-gate.ts'),
      'validate',
      '--runs-dir',
      validationDir,
    ],
    { cwd: context.repository },
  );
}

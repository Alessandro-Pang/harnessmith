import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {import('./assertion-types.mjs').SetAssertions} setAssertions
 */
export function evaluateWorkflowScenarios(context, setAssertions) {
  const { scenarioId, repo, before, after, personal, markdownFiles } = context;
  if (scenarioId === 'experience-distillation-promotion') {
    const architecture = readFileSync(join(repo, 'docs', 'architecture.md'), 'utf8').toLowerCase();
    const distilled = markdownFiles(join(repo, '.agent-docs', 'distilled'));
    const core = readFileSync(join(repo, '.agent-docs', 'core.md'), 'utf8');
    setAssertions(
      [
        distilled.length >= 1 &&
          distilled.some((path) => /jitter|抖动/i.test(readFileSync(path, 'utf8'))),
        /jitter|抖动/.test(architecture) && core.includes('memory:'),
      ],
      [null],
    );
  }
  if (scenarioId === 'task-acceptance-gate') {
    const workingRoot = join(repo, '.agent-docs', 'working');
    /** @type {{ status?: unknown, checkpoints?: { nextAction?: unknown }[], acceptance?: { status?: unknown, evidence?: { producer?: unknown, verificationPassed?: unknown }[] }[] }[]} */
    const taskRecords = (
      existsSync(workingRoot) ? readdirSync(workingRoot, { withFileTypes: true }) : []
    )
      .filter(
        (entry) => entry.isDirectory() && existsSync(join(workingRoot, entry.name, 'task.json')),
      )
      .map((entry) => JSON.parse(readFileSync(join(workingRoot, entry.name, 'task.json'), 'utf8')));
    const completedTask = taskRecords.find(
      (task) =>
        task.status === 'complete' &&
        task.checkpoints &&
        task.checkpoints.length >= 2 &&
        task.checkpoints.some((checkpoint) => checkpoint.nextAction) &&
        task.acceptance?.length === 2 &&
        task.acceptance.every(
          (criterion) =>
            criterion.status === 'passed' &&
            criterion.evidence?.some(
              (evidence) => evidence.producer === 'harness' && evidence.verificationPassed === true,
            ),
        ),
    );
    const core = readFileSync(join(repo, '.agent-docs', 'core.md'), 'utf8');
    setAssertions(
      [
        Boolean(completedTask),
        !core.includes('memory:working/correct-add-regression/progress'),
        Boolean(completedTask),
      ],
      [Boolean(completedTask)],
    );
  }
  if (scenarioId === 'cross-repository-map-writeback') {
    const canonicalMap = readFileSync(
      join(personal, 'projects', 'repository-map.yaml'),
      'utf8',
    ).toLowerCase();
    const generatedMap = readFileSync(
      join(personal, 'projects', 'repository-map.md'),
      'utf8',
    ).toLowerCase();
    const stableEdge =
      canonicalMap.includes('type: package') &&
      canonicalMap.includes('provider: service-b') &&
      canonicalMap.includes('consumer: service-a') &&
      canonicalMap.includes('side: provider') &&
      canonicalMap.includes('side: consumer');
    setAssertions(
      [stableEdge && generatedMap.includes('generated from repository-map.yaml'), stableEdge, null],
      [after === before, !/migration is 40%|dirty|head:|branch:/.test(canonicalMap)],
    );
  }
}

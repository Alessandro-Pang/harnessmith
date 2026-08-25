import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import type { AnySchema } from 'ajv';
import { Ajv2020 } from 'ajv/dist/2020.js';
import {
  createArtifactVerificationBudget,
  type RunRecord,
  verifyHighConfidenceSecretRedaction,
  verifyRunArtifacts,
} from './eval-artifacts.js';
import { evaluationScenarioFingerprints, repositoryRoot } from './eval-fingerprint.js';

export type VerifiedRun = { path: string; record: RunRecord };
export interface EvaluationRecordOptions {
  runsDirectory?: string;
}
type ExpectedAssertion = { id: string; description: string };
const maximumRunRecordBytes = 8 * 1024 * 1024;
const maximumAggregateRunRecordBytes = 64 * 1024 * 1024;
const maximumRunRecords = 512;

function json(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runRecordPaths(root: string): string[] {
  const pending = [{ path: root, depth: 0 }];
  const paths: string[] = [];
  let entries = 0;
  while (pending.length > 0) {
    const directory = pending.pop();
    if (!directory) continue;
    if (directory.depth > 8)
      throw new Error(`Host evaluation directory exceeds depth limit: ${root}`);
    for (const entry of readdirSync(directory.path, { withFileTypes: true })) {
      entries += 1;
      if (entries > 10_000)
        throw new Error(`Host evaluation directory exceeds entry limit: ${root}`);
      const target = join(directory.path, entry.name);
      if (entry.name === 'run.json') {
        paths.push(target);
        if (paths.length > maximumRunRecords)
          throw new Error(`Host evaluation directory exceeds ${maximumRunRecords} run records`);
      } else if (entry.isDirectory()) {
        pending.push({ path: target, depth: directory.depth + 1 });
      }
    }
  }
  return paths.sort();
}

function readRunRecord(path: string, budget: { totalBytes: number }): string {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`Unsafe run record ${relative(repositoryRoot, path)}: expected a regular file`);
  }
  if (stat.size > maximumRunRecordBytes) {
    throw new Error(
      `${relative(repositoryRoot, path)} exceeds the ${maximumRunRecordBytes}-byte record limit`,
    );
  }
  if (budget.totalBytes + stat.size > maximumAggregateRunRecordBytes) {
    throw new Error(
      `aggregate run records exceed the ${maximumAggregateRunRecordBytes}-byte validation limit`,
    );
  }
  budget.totalBytes += stat.size;
  return readFileSync(path, 'utf8');
}

function expectedAssertions(): Record<
  string,
  { pass: ExpectedAssertion[]; forbidden: ExpectedAssertion[] }
> {
  const catalog = json(join(repositoryRoot, 'evals', 'scenarios.json')) as {
    scenarios: Array<{ id: string; pass: string[]; forbidden: string[] }>;
  };
  return Object.fromEntries(
    catalog.scenarios.map(({ id, pass, forbidden }) => [
      id,
      {
        pass: pass.map((description, index) => ({ id: `pass-${index + 1}`, description })),
        forbidden: forbidden.map((description, index) => ({
          id: `forbidden-${index + 1}`,
          description,
        })),
      },
    ]),
  );
}

function verifyExpectedAssertions(
  path: string,
  actual: Array<{ id: string; description: string }>,
  expected: ExpectedAssertion[],
  assertionLabel: 'scenario' | 'forbidden',
  conditionLabel: 'pass' | 'forbidden',
): void {
  const actualIds = actual.map(({ id }) => id);
  const expectedIds = expected.map(({ id }) => id);
  if (
    new Set(actualIds).size !== actualIds.length ||
    expected.length !== actualIds.length ||
    expectedIds.some((id) => !actualIds.includes(id))
  ) {
    throw new Error(
      `${relative(repositoryRoot, path)} ${assertionLabel} assertions must match ${expectedIds.join(', ')}`,
    );
  }
  for (const expectedAssertion of expected) {
    const actualAssertion = actual.find(({ id }) => id === expectedAssertion.id);
    if (actualAssertion?.description !== expectedAssertion.description) {
      throw new Error(
        `${relative(repositoryRoot, path)} ${expectedAssertion.id} description must exactly match its scenario ${conditionLabel} condition`,
      );
    }
  }
}

export function validateEvaluationRecords(options: EvaluationRecordOptions = {}): VerifiedRun[] {
  const runsDirectory = resolve(
    repositoryRoot,
    options.runsDirectory ?? process.env.HARNESS_EVAL_RUNS_DIR ?? 'evals/runs',
  );
  if (!existsSync(runsDirectory)) {
    throw new Error(
      `No maintainer-attested host evaluation record structures found in ${runsDirectory}`,
    );
  }
  const paths = runRecordPaths(runsDirectory);
  if (paths.length === 0) {
    throw new Error(
      `No maintainer-attested host evaluation record structures found in ${runsDirectory}`,
    );
  }
  const schema = json(join(repositoryRoot, 'evals', 'run.schema.json')) as AnySchema;
  const validate = new Ajv2020({ allErrors: true, strict: true }).compile(schema);
  const scenarioFingerprints = evaluationScenarioFingerprints();
  const scenarioIds = new Set(Object.keys(scenarioFingerprints));
  const assertionsByScenario = expectedAssertions();
  const runIds = new Set<string>();
  const verified: VerifiedRun[] = [];
  const recordBudget = { totalBytes: 0 };
  const artifactBudget = createArtifactVerificationBudget();
  for (const path of paths) {
    const rawRecord = readRunRecord(path, recordBudget);
    verifyHighConfidenceSecretRedaction(relative(repositoryRoot, path), rawRecord);
    const record = JSON.parse(rawRecord) as RunRecord;
    if (!validate(record)) {
      throw new Error(
        `${relative(repositoryRoot, path)} violates run schema: ${JSON.stringify(validate.errors)}`,
      );
    }
    if (record.recordType !== 'host-evaluation') {
      throw new Error(
        `${relative(repositoryRoot, path)} is example-only and cannot satisfy the maintainer-attested record gate`,
      );
    }
    if (!scenarioIds.has(record.scenarioId)) {
      throw new Error(
        `${relative(repositoryRoot, path)} has unknown scenario: ${record.scenarioId}`,
      );
    }
    if (record.subject.scenarioSha256 === scenarioFingerprints[record.scenarioId]) {
      const expected = assertionsByScenario[record.scenarioId];
      verifyExpectedAssertions(path, record.scenarioAssertions, expected.pass, 'scenario', 'pass');
      verifyExpectedAssertions(
        path,
        record.forbiddenActionAssertions,
        expected.forbidden,
        'forbidden',
        'forbidden',
      );
    }
    if (runIds.has(record.runId)) throw new Error(`duplicate runId: ${record.runId}`);
    runIds.add(record.runId);
    if (record.toolActions.some(({ sequence }, index) => sequence !== index + 1)) {
      throw new Error('toolActions sequence must be contiguous starting at 1');
    }
    if (record.filesystemDiff.clean !== (record.filesystemDiff.changedPaths.length === 0)) {
      throw new Error('filesystemDiff clean flag conflicts with changedPaths');
    }
    verifyRunArtifacts(path, record, artifactBudget);
    verified.push({ path, record });
  }
  return verified;
}

export function latestEvaluationRecords(records: VerifiedRun[]): VerifiedRun[] {
  const byCell = new Map<string, VerifiedRun[]>();
  for (const run of records) {
    const key = `${run.record.host.adapter}/${run.record.scenarioId}`;
    byCell.set(key, [...(byCell.get(key) ?? []), run]);
  }
  return [...byCell.entries()].map(([key, cell]) => {
    const candidates = cell
      .map((run) => ({ run, evaluatedAt: Date.parse(run.record.evaluatedAt) }))
      .sort(
        (left, right) =>
          right.evaluatedAt - left.evaluatedAt ||
          left.run.record.runId.localeCompare(right.run.record.runId),
      );
    const invalid = candidates.find(({ evaluatedAt }) => !Number.isFinite(evaluatedAt));
    if (invalid) {
      throw new Error(
        `${relative(repositoryRoot, invalid.run.path)} has an invalid evaluatedAt timestamp`,
      );
    }
    const latest = candidates[0];
    const tied = candidates.filter(({ evaluatedAt }) => evaluatedAt === latest.evaluatedAt);
    if (tied.length > 1) {
      throw new Error(
        `Ambiguous latest evaluatedAt for ${key}: ${tied
          .map(({ run }) => run.record.runId)
          .sort()
          .join(', ')}`,
      );
    }
    return latest.run;
  });
}

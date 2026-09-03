import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { test } from 'vitest';
import {
  candidateArtifact,
  currentFingerprint,
  digest,
  root,
  run,
  temporaryDirectory,
  writeRun,
} from './run-fixture.js';

test('fingerprint binds the candidate package and every complete scenario contract', () => {
  const result = run(['fingerprint', '--json', '--package-artifact', candidateArtifact], {
    HARNESS_RELEASE_ARTIFACT: '',
  });
  assert.equal(result.status, 0, result.stderr);

  const output = JSON.parse(result.stdout);
  const packageManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  const harnessManifest = JSON.parse(
    readFileSync(join(root, 'template', 'agent-harness', 'manifest.json'), 'utf8'),
  );
  const catalog = JSON.parse(readFileSync(join(root, 'evals', 'scenarios.json'), 'utf8'));

  assert.equal(output.packageVersion, packageManifest.version);
  assert.equal(output.harnessVersion, harnessManifest.harnessVersion);
  assert.equal(output.packageArtifactSha256, digest(readFileSync(candidateArtifact)));
  assert.match(output.behaviorSha256, /^[a-f0-9]{64}$/);
  assert.notEqual(output.behaviorSha256, output.packageArtifactSha256);
  assert.match(output.rulesSha256, /^[a-f0-9]{64}$/);
  assert.deepEqual(Object.keys(output.scenarioDependencies), Object.keys(output.scenarios));
  for (const dependencySha256 of Object.values(output.scenarioDependencies)) {
    assert.match(dependencySha256 as string, /^[a-f0-9]{64}$/);
  }
  for (const source of [
    'dist/adapters/adapters.js',
    'dist/installation/install-template.js',
    'dist/installation/lifecycle.js',
    'template/AGENTS.md',
    'template/agent-harness/docs/README.md',
    'template/agent-harness/manifest.json',
    'template/agent-harness/schemas/task.schema.json',
    'template/agent-harness/dist/harness.mjs',
    'template/agent-harness/templates/project-AGENTS.md',
  ]) {
    assert.ok(output.ruleSources.includes(source), `missing rule fingerprint source: ${source}`);
  }
  assert.deepEqual(
    output.scenarios,
    Object.fromEntries(
      catalog.scenarios.map(
        (scenario: {
          id: string;
          prompt: string;
          setup: string[];
          pass: string[];
          forbidden: string[];
        }) => [
          scenario.id,
          createHash('sha256')
            .update(
              JSON.stringify({
                id: scenario.id,
                prompt: scenario.prompt,
                setup: scenario.setup,
                pass: scenario.pass,
                forbidden: scenario.forbidden,
              }),
            )
            .digest('hex'),
        ],
      ),
    ),
  );
});

test('fingerprint fails closed without an exact candidate package artifact', () => {
  const result = run(['fingerprint', '--json'], {
    ...process.env,
    HARNESS_RELEASE_ARTIFACT: '',
  });

  assert.equal(result.status, 1);
  assert.match(result.stderr, /HARNESS_RELEASE_ARTIFACT|--package-artifact/);
});

test('validator fails closed when no maintainer-attested record structures exist', () => {
  const result = run(['validate', '--runs-dir', temporaryDirectory()]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /No maintainer-attested host evaluation record structures found/);
});

test('validator rejects the example fixture as release evidence', () => {
  const runsDirectory = temporaryDirectory();
  const exampleDirectory = join(runsDirectory, 'copied-example');
  mkdirSync(exampleDirectory, { recursive: true });
  writeFileSync(
    join(exampleDirectory, 'run.json'),
    readFileSync(join(root, 'evals', 'run.example.json')),
  );

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /example-only.*cannot satisfy the maintainer-attested record gate/i);
});

test('validator accepts a maintainer-attested record structure with verifiable local artifacts', () => {
  const runsDirectory = temporaryDirectory();
  writeRun(runsDirectory);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 maintainer-attested host evaluation record structure/);
});

test('validator accepts an explicit local evidence directory from the environment', () => {
  const runsDirectory = temporaryDirectory();
  writeRun(runsDirectory);

  const result = run(['validate'], { ...process.env, HARNESS_EVAL_RUNS_DIR: runsDirectory });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 maintainer-attested host evaluation record structure/);
});

test('validator rejects missing or tampered evidence artifacts', () => {
  const runsDirectory = temporaryDirectory();
  const record = writeRun(runsDirectory);
  writeFileSync(join(dirname(record), 'transcript.md'), 'tampered transcript\n');

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /transcript\.md.*SHA-256 mismatch/);
});

test('validator rejects a transcript that still contains a high-confidence credential', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const transcript = 'Authorization: Bearer secret-value-that-was-not-redacted\n';
  writeFileSync(join(dirname(path), 'transcript.md'), transcript);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.transcript.sha256 = digest(transcript);
  record.evidence.find((evidence: { id: string }) => evidence.id === 'redacted-transcript').sha256 =
    digest(transcript);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /transcript\.md failed secret redaction check/);
});

test('validator scans every textual evidence artifact for high-confidence credentials', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const filesystemDiff = 'Authorization: Bearer secret-value-that-was-not-redacted\n';
  writeFileSync(join(dirname(path), 'filesystem-diff.txt'), filesystemDiff);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.filesystemDiff.sha256 = digest(filesystemDiff);
  record.evidence.find((evidence: { id: string }) => evidence.id === 'filesystem-diff').sha256 =
    digest(filesystemDiff);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /filesystem-diff\.txt failed secret redaction check/);
});

test('validator ignores auxiliary JSON artifacts and reads only run.json contracts', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  writeFileSync(join(dirname(path), 'observation.json'), '{"kind":"auxiliary evidence"}\n');

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Validated 1 maintainer-attested host evaluation record structure/);
});

test('validator rejects an artifact symlink that escapes the record directory', () => {
  const runsDirectory = temporaryDirectory();
  const record = writeRun(runsDirectory);
  const transcript = join(dirname(record), 'transcript.md');
  const outside = join(runsDirectory, 'outside-transcript.md');
  writeFileSync(outside, readFileSync(transcript));
  rmSync(transcript);
  symlinkSync(outside, transcript);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unsafe artifact reference.*transcript\.md/);
});

test('validator rejects verdicts and safety assertions with dangling evidence references', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.verdict.evidenceRefs = ['missing-evidence'];
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /verdict references unknown evidence: missing-evidence/);
});

test('validator binds the transcript artifact to verdict evidence', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.evidence = record.evidence.filter(
    (evidence: { id: string }) => evidence.id !== 'redacted-transcript',
  );
  record.verdict.evidenceRefs = ['filesystem-diff'];
  for (const assertion of record.scenarioAssertions) {
    assertion.evidenceRefs = ['filesystem-diff'];
  }
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /transcript artifact must be represented in verdict evidence/);
});

test('validator binds the filesystem diff artifact to verdict evidence', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.evidence = record.evidence.filter(
    (evidence: { id: string }) => evidence.id !== 'filesystem-diff',
  );
  record.verdict.evidenceRefs = ['redacted-transcript'];
  for (const assertion of record.forbiddenActionAssertions) {
    assertion.evidenceRefs = ['redacted-transcript'];
  }
  for (const assertion of record.scenarioAssertions) {
    assertion.evidenceRefs = ['redacted-transcript'];
  }
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /filesystem diff artifact must be represented in verdict evidence/);
});

test('validator requires tool actions to be ordered without sequence gaps', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.toolActions[0].sequence = 2;
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /toolActions sequence must be contiguous starting at 1/);
});

test('validator rejects a contradictory filesystem diff summary', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.filesystemDiff.changedPaths = ['packages/cli/src/unexpected.ts'];
  record.filesystemDiff.clean = true;
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /filesystemDiff clean flag conflicts with changedPaths/);
});

test('release gate fails when supported hosts and scenarios lack fresh passing coverage', () => {
  const runsDirectory = temporaryDirectory();
  writeRun(runsDirectory);

  const result = run(['gate', '--runs-dir', runsDirectory, '--max-age-days', '30']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /Missing fresh passing host evaluation coverage/);
  assert.match(result.stderr, /codex\/bootstrap-global-memory/);
  assert.doesNotMatch(result.stderr, /cursor\//);
  assert.doesNotMatch(result.stderr, /claude\//);
});

test('release gate identifies stale records instead of counting them as coverage', () => {
  const runsDirectory = temporaryDirectory();
  writeRun(runsDirectory, { finishedAt: '2025-01-01T00:00:00Z' });

  const result = run(['gate', '--runs-dir', runsDirectory, '--max-age-days', '30']);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /stale.*codex\/progressive-disclosure/i);
});

test('release gate emits machine-readable success only for the complete fresh host matrix', () => {
  const runsDirectory = temporaryDirectory();
  const scenarioIds = Object.keys(currentFingerprint().scenarios);
  const adapters = ['codex'] as const;
  for (const adapter of adapters) {
    for (const scenarioId of scenarioIds) writeRun(runsDirectory, { adapter, scenarioId });
  }

  const result = run(['gate', '--runs-dir', runsDirectory, '--max-age-days', '30', '--json']);
  const exact = scenarioIds.map((scenarioId) => `codex/${scenarioId}`);

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), {
    valid: true,
    assurance: 'maintainer-attested-structure',
    packageArtifactSha256: currentFingerprint().packageArtifactSha256,
    behaviorSha256: currentFingerprint().behaviorSha256,
    coverageCount: adapters.length * scenarioIds.length,
    exactArtifactCoverageCount: adapters.length * scenarioIds.length,
    inheritedBehaviorCoverageCount: 0,
    inheritedFrom: [],
    evidence: { exact, inherited: [], infraBlocked: [] },
    hosts: adapters,
    scenarios: scenarioIds,
    maxAgeDays: 30,
  });
});

test('validator rejects records for scenarios outside the versioned catalog', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.scenarioId = 'invented-scenario';
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /unknown scenario: invented-scenario/);
});

test('validator rejects duplicate run identities across evidence files', () => {
  const runsDirectory = temporaryDirectory();
  const first = writeRun(runsDirectory);
  const second = writeRun(runsDirectory, { adapter: 'cursor' });
  const firstRecord = JSON.parse(readFileSync(first, 'utf8'));
  const secondRecord = JSON.parse(readFileSync(second, 'utf8'));
  secondRecord.runId = firstRecord.runId;
  writeFileSync(second, `${JSON.stringify(secondRecord, null, 2)}\n`);

  const result = run(['validate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /duplicate runId: codex-progressive-disclosure/);
});

test('release gate retains the global rule fingerprint as audit data', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.subject.rulesSha256 = 'f'.repeat(64);
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['gate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.doesNotMatch(result.stderr, /subject-drift rulesSha256/);
  assert.match(result.stderr, /codex\/bootstrap-global-memory/);
});

test('evaluation schema supports every adapter while release coverage uses the explicit host policy', async () => {
  const { requiredEvaluationAdapters } = await import(
    '../../scripts/evaluation/records/eval-fingerprint.js'
  );
  const { checkEvalRunSchemaAdapterEnum } = await import(
    '../../scripts/evaluation/contracts/eval-run-schema.js'
  );

  assert.equal(checkEvalRunSchemaAdapterEnum(root).ok, true);
  assert.deepEqual(requiredEvaluationAdapters, ['codex']);
});

test('release gate rejects a passing verdict when a forbidden-action assertion failed', () => {
  const runsDirectory = temporaryDirectory();
  const path = writeRun(runsDirectory);
  const record = JSON.parse(readFileSync(path, 'utf8'));
  record.forbiddenActionAssertions[0].passed = false;
  writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`);

  const result = run(['gate', '--runs-dir', runsDirectory]);

  assert.equal(result.status, 1);
  assert.match(result.stderr, /forbidden-action-failure forbidden-1 codex\/progressive-disclosure/);
});

test('declared package release workflow gates the exact tarball before publication', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

  assert.match(manifest.scripts['eval:fingerprint'], /eval-gate\.ts fingerprint --json/);
  assert.match(manifest.scripts['eval:validate'], /eval-gate\.ts validate/);
  assert.match(manifest.scripts['eval:gate'], /eval-gate\.ts gate/);
  assert.equal(manifest.scripts['release:check'], 'pnpm run release:quality && pnpm run eval:gate');
  assert.match(manifest.scripts['release:prepare'], /--prepare-only/);
  assert.match(manifest.scripts['release:publish'], /scripts\/release\/release-publish\.ts/);
  assert.match(manifest.scripts.release, /scripts\/release\/release-version\.ts/);
  assert.match(manifest.scripts.prepublishOnly, /release-publish\.ts guard/);
});

test('evaluation and release docs distinguish contracts from real fresh host evidence', () => {
  const evalReadme = readFileSync(join(root, 'evals', 'README.md'), 'utf8');
  const releasing = readFileSync(join(root, 'RELEASING.md'), 'utf8');
  const architecture = readFileSync(join(root, 'apps', 'docs', 'site', 'architecture.md'), 'utf8');

  for (const required of [
    'pnpm run eval:fingerprint',
    'pnpm run eval:validate',
    'pnpm run eval:gate',
    'HARNESS_EVAL_RUNS_DIR',
    'recordType: host-evaluation',
    'complete required-host × scenario matrix',
    'current required host is Codex',
    'maintainer-attested structure',
    'cannot prove that a real Host produced the submitted artifacts',
    'behaviorSha256',
    'metadata-only release',
    'invalidates only that scenario',
    'EVAL_COVERAGE_INCOMPLETE',
    'Rejected record summary',
  ]) {
    assert.ok(evalReadme.includes(required), `evals/README.md is missing ${required}`);
  }
  assert.match(releasing, /pnpm run eval:gate/);
  assert.match(releasing, /fails when.*fresh.*real-host records/is);
  assert.match(releasing, /HARNESS_RELEASE_ARTIFACT/);
  assert.match(releasing, /maintainer-attested structure/i);
  assert.match(releasing, /current required host is Codex/i);
  assert.match(releasing, /Host Eval inheritance/i);
  assert.match(releasing, /exact candidate tarball/i);
  assert.match(architecture, /executable release gate/i);
  assert.match(architecture, /不会启动第三方宿主.*不负责登录或认证/s);
});

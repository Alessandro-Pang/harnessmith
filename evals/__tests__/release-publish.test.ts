import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import {
  type ReleaseRunner,
  releaseCandidate,
  releasePublishGuard,
} from '../../scripts/release-publish.js';
import {
  candidateArtifact,
  currentFingerprint,
  digest,
  temporaryDirectory,
} from './run-fixture.js';

const inheritedSource = {
  packageVersion: '0.5.0',
  packageArtifactSha256: 'f'.repeat(64),
};

function evaluationGate() {
  const fingerprint = currentFingerprint();
  const coverageCount = Object.keys(fingerprint.scenarios).length;
  return {
    valid: true as const,
    assurance: 'maintainer-attested-structure' as const,
    packageArtifactSha256: digest(readFileSync(candidateArtifact)),
    behaviorSha256: fingerprint.behaviorSha256,
    coverageCount,
    exactArtifactCoverageCount: 0,
    inheritedBehaviorCoverageCount: coverageCount,
    inheritedFrom: [inheritedSource],
    hosts: ['codex'],
    scenarios: Object.keys(fingerprint.scenarios),
    maxAgeDays: 30,
  };
}

function release(args: string[], runner: ReleaseRunner): void {
  releaseCandidate(args, runner, evaluationGate);
}

test('release publish workflow checks and publishes the same candidate tarball', () => {
  const stateDirectory = temporaryDirectory();
  const calls: Array<{ executable: string; args: string[]; artifact?: string }> = [];
  const runner: ReleaseRunner = (executable, args, options) => {
    calls.push({ executable, args, artifact: options.env.HARNESS_RELEASE_ARTIFACT });
    return { status: 0, signal: null, error: undefined };
  };

  release(
    ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory, '--dry-run'],
    runner,
  );

  assert.equal(calls.length, 2);
  assert.match(calls[0].executable, /pnpm(?:\.cmd)?$/);
  assert.deepEqual(calls[0].args, ['run', 'release:check']);
  assert.notEqual(calls[0].artifact, candidateArtifact);
  assert.match(calls[1].executable, /npm(?:\.cmd)?$/);
  assert.deepEqual(calls[1].args, ['publish', calls[0].artifact, '--dry-run']);
  assert.equal(calls[1].artifact, calls[0].artifact);
});

test('release publish accepts standard equals-style CLI options', () => {
  const stateDirectory = temporaryDirectory();
  const calls: Array<{ args: string[]; artifact?: string }> = [];
  const runner: ReleaseRunner = (_executable, args, options) => {
    calls.push({ args, artifact: options.env.HARNESS_RELEASE_ARTIFACT });
    return { status: 0, signal: null, error: undefined };
  };

  release(
    [
      `--package-artifact=${candidateArtifact}`,
      `--state-dir=${stateDirectory}`,
      '--tag=next',
      '--dry-run',
    ],
    runner,
  );

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ['publish', calls[0].artifact, '--dry-run', '--tag', 'next']);
});

test('release publish workflow stops before npm when release checks fail', () => {
  const stateDirectory = temporaryDirectory();
  const calls: string[] = [];
  const runner: ReleaseRunner = (executable) => {
    calls.push(executable);
    return { status: 1, signal: null, error: undefined };
  };

  assert.throws(
    () => release(['--package-artifact', candidateArtifact, '--state-dir', stateDirectory], runner),
    /release checks failed/i,
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /pnpm(?:\.cmd)?$/);
});

test('release publish workflow rejects arguments that could replace the exact package', () => {
  const stateDirectory = temporaryDirectory();
  const runner: ReleaseRunner = () => ({ status: 0, signal: null, error: undefined });

  assert.throws(
    () =>
      release(
        ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory, 'another.tgz'],
        runner,
      ),
    /too many arguments/i,
  );
});

test('release publish keeps one immutable candidate after checks and publishes that snapshot', () => {
  const stateDirectory = temporaryDirectory();
  const artifact = join(temporaryDirectory(), 'candidate.tgz');
  copyFileSync(candidateArtifact, artifact);
  const expectedDigest = digest(readFileSync(artifact));
  let stagedPath = '';
  let publishedDigest = '';
  let calls = 0;
  const runner: ReleaseRunner = (_executable, args, options) => {
    calls += 1;
    if (calls === 1) {
      stagedPath = options.env.HARNESS_RELEASE_ARTIFACT ?? '';
      writeFileSync(artifact, 'source changed after staging');
    } else {
      assert.equal(args[0], 'publish');
      assert.equal(args[1], stagedPath);
      publishedDigest = digest(readFileSync(stagedPath));
    }
    return { status: 0, signal: null, error: undefined };
  };

  release(['--package-artifact', artifact, '--state-dir', stateDirectory, '--dry-run'], runner);

  assert.notEqual(stagedPath, artifact);
  assert.equal(publishedDigest, expectedDigest);
  assert.equal(existsSync(stagedPath), true);
});

test('release publish preserves a checked snapshot and resumes without rerunning gates', () => {
  const stateDirectory = temporaryDirectory();
  const firstCalls: string[][] = [];
  const firstRunner: ReleaseRunner = (_executable, args) => {
    firstCalls.push(args);
    if (args[0] === 'publish') {
      return { status: 1, signal: null, error: new Error('EOTP') };
    }
    return { status: 0, signal: null, error: undefined };
  };

  assert.throws(
    () =>
      release(
        ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory],
        firstRunner,
      ),
    /EOTP/,
  );
  assert.equal(firstCalls.length, 2);
  const stagedPath = firstCalls[1][1];
  assert.equal(existsSync(stagedPath), true);

  const retryCalls: string[][] = [];
  const retryRunner: ReleaseRunner = (_executable, args) => {
    retryCalls.push(args);
    return { status: 0, signal: null, error: undefined };
  };
  release(['--state-dir', stateDirectory], retryRunner);

  assert.deepEqual(retryCalls, [['publish', stagedPath]]);
  assert.equal(existsSync(stagedPath), true);
});

test('release prepare prefers HARNESS_RELEASE_ARTIFACT over an existing prepared state', () => {
  const stateDirectory = temporaryDirectory();
  const replacementArtifact = join(temporaryDirectory(), 'replacement.tgz');
  copyFileSync(candidateArtifact, replacementArtifact);
  const calls: string[][] = [];
  const runner: ReleaseRunner = (_executable, args) => {
    calls.push(args);
    return { status: 0, signal: null, error: undefined };
  };

  release(
    ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory, '--prepare-only'],
    runner,
  );
  const initialState = JSON.parse(readFileSync(join(stateDirectory, 'release-state.json'), 'utf8'));
  calls.length = 0;

  const previousArtifact = process.env.HARNESS_RELEASE_ARTIFACT;
  process.env.HARNESS_RELEASE_ARTIFACT = replacementArtifact;
  try {
    release(['--state-dir', stateDirectory, '--prepare-only'], runner);
  } finally {
    if (previousArtifact === undefined) delete process.env.HARNESS_RELEASE_ARTIFACT;
    else process.env.HARNESS_RELEASE_ARTIFACT = previousArtifact;
  }

  const replacementState = JSON.parse(
    readFileSync(join(stateDirectory, 'release-state.json'), 'utf8'),
  );
  assert.deepEqual(calls, [['run', 'release:check']]);
  assert.notEqual(replacementState.artifactPath, initialState.artifactPath);
  assert.match(replacementState.artifactPath, /replacement\.tgz$/);
});

test('release prepare prefers --package-artifact over existing state and environment', () => {
  const stateDirectory = temporaryDirectory();
  const environmentArtifact = join(temporaryDirectory(), 'environment.tgz');
  const cliArtifact = join(temporaryDirectory(), 'cli.tgz');
  copyFileSync(candidateArtifact, environmentArtifact);
  copyFileSync(candidateArtifact, cliArtifact);
  const calls: string[][] = [];
  const runner: ReleaseRunner = (_executable, args) => {
    calls.push(args);
    return { status: 0, signal: null, error: undefined };
  };

  release(
    ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory, '--prepare-only'],
    runner,
  );
  calls.length = 0;

  const previousArtifact = process.env.HARNESS_RELEASE_ARTIFACT;
  process.env.HARNESS_RELEASE_ARTIFACT = environmentArtifact;
  try {
    release(
      ['--package-artifact', cliArtifact, '--state-dir', stateDirectory, '--prepare-only'],
      runner,
    );
  } finally {
    if (previousArtifact === undefined) delete process.env.HARNESS_RELEASE_ARTIFACT;
    else process.env.HARNESS_RELEASE_ARTIFACT = previousArtifact;
  }

  const state = JSON.parse(readFileSync(join(stateDirectory, 'release-state.json'), 'utf8'));
  assert.deepEqual(calls, [['run', 'release:check']]);
  assert.match(state.artifactPath, /cli\.tgz$/);
});

test('release prepare checks a persistent snapshot without contacting npm', () => {
  const stateDirectory = temporaryDirectory();
  const calls: string[][] = [];
  const runner: ReleaseRunner = (_executable, args) => {
    calls.push(args);
    return { status: 0, signal: null, error: undefined };
  };

  release(
    ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory, '--prepare-only'],
    runner,
  );

  assert.deepEqual(calls, [['run', 'release:check']]);
  const state = JSON.parse(readFileSync(join(stateDirectory, 'release-state.json'), 'utf8'));
  assert.equal(state.schemaVersion, 3);
  assert.equal(state.evaluation.assurance, 'maintainer-attested-structure');
  assert.equal(state.evaluation.coverageCount, Object.keys(currentFingerprint().scenarios).length);
  assert.equal(state.evaluation.packageArtifactSha256, state.artifactSha256);
  assert.equal(state.evaluation.behaviorSha256, currentFingerprint().behaviorSha256);
  assert.equal(state.evaluation.exactArtifactCoverageCount, 0);
  assert.equal(
    state.evaluation.inheritedBehaviorCoverageCount,
    Object.keys(currentFingerprint().scenarios).length,
  );
  assert.deepEqual(state.evaluation.inheritedFrom, [inheritedSource]);
});

test('release resume rejects a prepared snapshot whose bytes changed', () => {
  const stateDirectory = temporaryDirectory();
  let stagedPath = '';
  const runner: ReleaseRunner = (_executable, args, options) => {
    if (args[0] === 'run') stagedPath = options.env.HARNESS_RELEASE_ARTIFACT ?? '';
    return { status: 0, signal: null, error: undefined };
  };
  release(
    ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory, '--prepare-only'],
    runner,
  );
  chmodSync(stagedPath, 0o600);
  writeFileSync(stagedPath, 'tampered');

  assert.throws(
    () => release(['--state-dir', stateDirectory], runner),
    /prepared release artifact changed/i,
  );
});

test('release resume rejects malformed evaluation evidence in persisted state', () => {
  const stateDirectory = temporaryDirectory();
  const runner: ReleaseRunner = () => ({ status: 0, signal: null, error: undefined });
  release(
    ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory, '--prepare-only'],
    runner,
  );
  const path = join(stateDirectory, 'release-state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.evaluation.requiredHosts = ['github-copilot'];
  state.evaluation.rulesSha256 = 'not-a-digest';
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);

  assert.throws(
    () => release(['--state-dir', stateDirectory], runner),
    /invalid release state structure/i,
  );
});

test('prepublish guard blocks unsupported direct worktree publication with recovery guidance', () => {
  assert.throws(
    () => releasePublishGuard({}),
    /pnpm run release:prepare.*pnpm run release:publish/is,
  );
  assert.doesNotThrow(() => releasePublishGuard({ HARNESS_RELEASE_WORKFLOW: '1' }));
});

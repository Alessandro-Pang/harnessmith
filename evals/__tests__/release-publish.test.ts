import assert from 'node:assert/strict';
import { chmodSync, copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import {
  type ReleaseRunner,
  releaseCandidate,
  releasePublishGuard,
} from '../../scripts/release-publish.js';
import { candidateArtifact, digest, temporaryDirectory } from './run-fixture.js';

test('release publish workflow checks and publishes the same candidate tarball', () => {
  const stateDirectory = temporaryDirectory();
  const calls: Array<{ executable: string; args: string[]; artifact?: string }> = [];
  const runner: ReleaseRunner = (executable, args, options) => {
    calls.push({ executable, args, artifact: options.env.HARNESS_RELEASE_ARTIFACT });
    return { status: 0, signal: null, error: undefined };
  };

  releaseCandidate(
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

  releaseCandidate(
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
    () =>
      releaseCandidate(
        ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory],
        runner,
      ),
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
      releaseCandidate(
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

  releaseCandidate(
    ['--package-artifact', artifact, '--state-dir', stateDirectory, '--dry-run'],
    runner,
  );

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
      releaseCandidate(
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
  releaseCandidate(['--state-dir', stateDirectory], retryRunner);

  assert.deepEqual(retryCalls, [['publish', stagedPath]]);
  assert.equal(existsSync(stagedPath), true);
});

test('release prepare checks a persistent snapshot without contacting npm', () => {
  const stateDirectory = temporaryDirectory();
  const calls: string[][] = [];
  const runner: ReleaseRunner = (_executable, args) => {
    calls.push(args);
    return { status: 0, signal: null, error: undefined };
  };

  releaseCandidate(
    ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory, '--prepare-only'],
    runner,
  );

  assert.deepEqual(calls, [['run', 'release:check']]);
  const state = JSON.parse(readFileSync(join(stateDirectory, 'release-state.json'), 'utf8'));
  assert.equal(state.schemaVersion, 2);
  assert.equal(state.evaluation.assurance, 'maintainer-attested-structure');
  assert.equal(state.evaluation.coverageCount, 11);
  assert.equal(state.evaluation.packageArtifactSha256, state.artifactSha256);
});

test('release resume rejects a prepared snapshot whose bytes changed', () => {
  const stateDirectory = temporaryDirectory();
  let stagedPath = '';
  const runner: ReleaseRunner = (_executable, args, options) => {
    if (args[0] === 'run') stagedPath = options.env.HARNESS_RELEASE_ARTIFACT ?? '';
    return { status: 0, signal: null, error: undefined };
  };
  releaseCandidate(
    ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory, '--prepare-only'],
    runner,
  );
  chmodSync(stagedPath, 0o600);
  writeFileSync(stagedPath, 'tampered');

  assert.throws(
    () => releaseCandidate(['--state-dir', stateDirectory], runner),
    /prepared release artifact changed/i,
  );
});

test('release resume rejects malformed evaluation evidence in persisted state', () => {
  const stateDirectory = temporaryDirectory();
  const runner: ReleaseRunner = () => ({ status: 0, signal: null, error: undefined });
  releaseCandidate(
    ['--package-artifact', candidateArtifact, '--state-dir', stateDirectory, '--prepare-only'],
    runner,
  );
  const path = join(stateDirectory, 'release-state.json');
  const state = JSON.parse(readFileSync(path, 'utf8'));
  state.evaluation.requiredHosts = ['github-copilot'];
  state.evaluation.rulesSha256 = 'not-a-digest';
  writeFileSync(path, `${JSON.stringify(state, null, 2)}\n`);

  assert.throws(
    () => releaseCandidate(['--state-dir', stateDirectory], runner),
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

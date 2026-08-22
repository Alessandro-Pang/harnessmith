import assert from 'node:assert/strict';
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { type ReleaseRunner, releaseCandidate } from '../../scripts/release-publish.js';
import { candidateArtifact, digest, temporaryDirectory } from './run-fixture.js';

test('release publish workflow checks and publishes the same candidate tarball', () => {
  const calls: Array<{ executable: string; args: string[]; artifact?: string }> = [];
  const runner: ReleaseRunner = (executable, args, options) => {
    calls.push({ executable, args, artifact: options.env.HARNESS_RELEASE_ARTIFACT });
    return { status: 0, signal: null, error: undefined };
  };

  releaseCandidate(['--package-artifact', candidateArtifact, '--dry-run'], runner);

  assert.equal(calls.length, 2);
  assert.match(calls[0].executable, /pnpm(?:\.cmd)?$/);
  assert.deepEqual(calls[0].args, ['run', 'release:check']);
  assert.notEqual(calls[0].artifact, candidateArtifact);
  assert.match(calls[1].executable, /npm(?:\.cmd)?$/);
  assert.deepEqual(calls[1].args, ['publish', calls[0].artifact, '--dry-run']);
  assert.equal(calls[1].artifact, calls[0].artifact);
});

test('release publish accepts standard equals-style CLI options', () => {
  const calls: Array<{ args: string[]; artifact?: string }> = [];
  const runner: ReleaseRunner = (_executable, args, options) => {
    calls.push({ args, artifact: options.env.HARNESS_RELEASE_ARTIFACT });
    return { status: 0, signal: null, error: undefined };
  };

  releaseCandidate([`--package-artifact=${candidateArtifact}`, '--tag=next', '--dry-run'], runner);

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[1].args, ['publish', calls[0].artifact, '--dry-run', '--tag', 'next']);
});

test('release publish workflow stops before npm when release checks fail', () => {
  const calls: string[] = [];
  const runner: ReleaseRunner = (executable) => {
    calls.push(executable);
    return { status: 1, signal: null, error: undefined };
  };

  assert.throws(
    () => releaseCandidate(['--package-artifact', candidateArtifact], runner),
    /release checks failed/i,
  );
  assert.equal(calls.length, 1);
  assert.match(calls[0], /pnpm(?:\.cmd)?$/);
});

test('release publish workflow rejects arguments that could replace the exact package', () => {
  const runner: ReleaseRunner = () => ({ status: 0, signal: null, error: undefined });

  assert.throws(
    () => releaseCandidate(['--package-artifact', candidateArtifact, 'another.tgz'], runner),
    /too many arguments/i,
  );
});

test('release publish snapshots one immutable candidate before checks and publishes that snapshot', () => {
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

  releaseCandidate(['--package-artifact', artifact, '--dry-run'], runner);

  assert.notEqual(stagedPath, artifact);
  assert.equal(publishedDigest, expectedDigest);
  assert.equal(existsSync(stagedPath), false);
});

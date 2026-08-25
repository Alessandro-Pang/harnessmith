import assert from 'node:assert/strict';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { test } from 'vitest';
import { candidateArtifact, currentFingerprint, temporaryDirectory } from './run-fixture.js';

const root = join(import.meta.dirname, '..', '..');
const modulePath = join(root, 'scripts', 'release-version.ts');

test('release version prepare promotes Unreleased and produces an exact candidate', async () => {
  assert.ok(existsSync(modulePath), 'release version workflow module is missing');
  const { prepareReleaseVersion } = await import('../../scripts/release-version.js');
  const fixture = temporaryDirectory();
  mkdirSync(join(fixture, '.release'));
  writeFileSync(join(fixture, 'package.json'), '{"name":"fixture","version":"1.2.3"}\n');
  writeFileSync(join(fixture, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n');
  writeFileSync(join(fixture, 'CHANGELOG.md'), '# Changelog\n\n## Unreleased\n\n- Fixed it.\n');
  writeFileSync(join(fixture, 'harnessmith-sbom.cdx.json'), '{}\n');
  const calls: string[][] = [];
  const runner = (_executable: string, args: string[]) => {
    calls.push(args);
    if (args[0] === 'status') return { status: 0, stdout: '', stderr: '' };
    if (args[0] === 'branch') return { status: 0, stdout: 'main\n', stderr: '' };
    if (args[0] === 'version') {
      writeFileSync(join(fixture, 'package.json'), '{"name":"fixture","version":"1.2.4"}\n');
      return { status: 0, stdout: 'v1.2.4\n', stderr: '' };
    }
    if (args[0] === 'pack') {
      const candidate = join(fixture, '.release', 'fixture-1.2.4.tgz');
      writeFileSync(candidate, 'candidate');
      return {
        status: 0,
        stdout: JSON.stringify([{ filename: 'fixture-1.2.4.tgz' }]),
        stderr: '',
      };
    }
    return { status: 0, stdout: '', stderr: '' };
  };

  const result = prepareReleaseVersion(['patch'], runner, {
    now: new Date('2026-08-24T12:00:00Z'),
    root: fixture,
  });

  assert.equal(result.version, '1.2.4');
  assert.equal(result.tag, 'v1.2.4');
  assert.equal(result.candidate, join(fixture, '.release', 'fixture-1.2.4.tgz'));
  const changelog = readFileSync(join(fixture, 'CHANGELOG.md'), 'utf8');
  assert.match(changelog, /## Unreleased\s+## 1\.2\.4 - 2026-08-24/);
  assert.ok(
    calls.some((args) => args.join(' ') === 'version patch --no-git-tag-version --ignore-scripts'),
  );
  assert.ok(calls.some((args) => args.join(' ') === 'run sbom'));
  assert.ok(calls.some((args) => args.join(' ') === 'run preflight'));
  assert.ok(calls.some((args) => args[0] === 'pack' && args.includes('--ignore-scripts')));
});

test('release attestation rejects a candidate digest that differs from local gates', async () => {
  assert.ok(existsSync(modulePath), 'release version workflow module is missing');
  const { verifyReleaseAttestation } = await import('../../scripts/release-version.js');
  assert.throws(
    () =>
      verifyReleaseAttestation(
        {
          schemaVersion: 2,
          packageName: 'harnessmith',
          packageVersion: '0.5.0',
          tag: 'v0.5.0',
          artifactSha256: 'a'.repeat(64),
          behaviorSha256: 'd'.repeat(64),
          harnessVersion: '2.4.0',
          rulesSha256: 'b'.repeat(64),
          scenarios: {},
          requiredHosts: ['codex'],
          coverageCount: 11,
          exactArtifactCoverageCount: 0,
          inheritedBehaviorCoverageCount: 11,
          inheritedFrom: [{ packageVersion: '0.4.1', packageArtifactSha256: 'e'.repeat(64) }],
          assurance: 'maintainer-attested-structure',
          preparedAt: '2026-08-24T12:00:00.000Z',
        },
        {
          packageName: 'harnessmith',
          packageVersion: '0.5.0',
          tag: 'v0.5.0',
          artifactSha256: 'c'.repeat(64),
          behaviorSha256: 'd'.repeat(64),
          harnessVersion: '2.4.0',
          rulesSha256: 'b'.repeat(64),
          scenarios: {},
          requiredHosts: ['codex'],
        },
      ),
    /artifact digest/i,
  );
});

test('tag publication workflow uses GitHub OIDC and the attested exact candidate', () => {
  const workflowPath = join(root, '.github', 'workflows', 'publish.yml');
  assert.ok(existsSync(workflowPath), 'tag publication workflow is missing');
  const workflow = readFileSync(workflowPath, 'utf8');
  assert.match(workflow, /tags:\s*\n\s*- ['"]v/);
  assert.match(workflow, /id-token:\s*write/);
  assert.match(workflow, /contents:\s*read/);
  assert.match(workflow, /environment:\s*npm/);
  assert.match(workflow, /release-version\.ts ci-verify/);
  assert.match(workflow, /npm@11\.6\.2/);
  assert.match(workflow, /npm publish .*\.tgz/);
  assert.match(workflow, /HARNESS_RELEASE_WORKFLOW:\s*['"]1['"]/);
  assert.match(workflow, /pnpm run test:coverage/);
  assert.match(workflow, /pnpm run sbom:check/);
  assert.doesNotMatch(workflow, /\+\s+--artifact/);
  assert.doesNotMatch(workflow, /NODE_AUTH_TOKEN|NPM_TOKEN|secrets\./);
});

test('release finalization leaves no attestation when unexpected worktree changes exist', async () => {
  const { finalizeReleaseVersion } = await import('../../scripts/release-finalize.js');
  const { writeReleaseState } = await import('../../scripts/release-state.js');
  const fixture = temporaryDirectory();
  const directory = join(fixture, '.release');
  mkdirSync(directory);
  const fingerprint = currentFingerprint();
  writeFileSync(
    join(fixture, 'package.json'),
    `${JSON.stringify({ name: 'harnessmith', version: fingerprint.packageVersion })}\n`,
  );
  const artifact = join(directory, 'candidate.tgz');
  copyFileSync(candidateArtifact, artifact);
  chmodSync(artifact, 0o400);
  writeReleaseState(directory, {
    schemaVersion: 3,
    status: 'prepared',
    artifactPath: artifact,
    artifactSha256: fingerprint.packageArtifactSha256,
    packageVersion: fingerprint.packageVersion,
    preparedAt: '2026-08-24T12:00:00.000Z',
    evaluation: {
      assurance: 'maintainer-attested-structure',
      coverageCount: Object.keys(fingerprint.scenarios).length,
      exactArtifactCoverageCount: 0,
      inheritedBehaviorCoverageCount: Object.keys(fingerprint.scenarios).length,
      inheritedFrom: [{ packageVersion: '0.5.0', packageArtifactSha256: 'f'.repeat(64) }],
      packageArtifactSha256: fingerprint.packageArtifactSha256,
      behaviorSha256: fingerprint.behaviorSha256,
      harnessVersion: fingerprint.harnessVersion,
      rulesSha256: fingerprint.rulesSha256,
      scenarios: fingerprint.scenarios,
      requiredHosts: ['codex'],
    },
  });
  const runner = (_executable: string, args: string[]) => ({
    status: 0,
    stdout: args[0] === 'status' ? ' M package.json\n?? unexpected.txt\n' : '',
    stderr: '',
  });

  assert.throws(
    () => finalizeReleaseVersion(runner, fixture),
    /unexpected release worktree change/i,
  );
  assert.equal(existsSync(join(fixture, 'release-attestation.json')), false);
});

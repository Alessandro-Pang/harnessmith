import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execaSync } from 'execa';
import writeFileAtomic from 'write-file-atomic';
import {
  evaluationFingerprint,
  repositoryRoot,
  requiredEvaluationAdapters,
} from './eval-fingerprint.js';
import {
  createReleaseAttestation,
  type ReleaseAttestation,
  type ReleaseSubject,
  verifyReleaseAttestation,
} from './release-attestation.js';
import { checkedPreparedState, readReleaseState } from './release-state.js';

interface CommandResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

export type FinalizeRunner = (
  executable: string,
  args: string[],
  options: { cwd: string },
) => CommandResult;

const defaultRunner: FinalizeRunner = (executable, args, options) => {
  const result = execaSync(executable, args, { cwd: options.cwd, reject: false });
  return {
    status: result.exitCode ?? null,
    stdout: result.stdout,
    stderr: result.stderr,
  };
};

const releaseFiles = ['package.json', 'pnpm-lock.yaml', 'release-attestation.json'] as const;

function checked(label: string, args: string[], root: string, runner: FinalizeRunner): string {
  const result = runner('git', args, { cwd: root });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${result.stderr || `exit ${String(result.status)}`}`);
  }
  return result.stdout;
}

function packageManifest(root: string): { name: string; version: string } {
  return JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    name: string;
    version: string;
  };
}

function attestationSubject(artifact: string, tag: string, root: string): ReleaseSubject {
  const manifest = packageManifest(root);
  const fingerprint = evaluationFingerprint(artifact);
  return {
    packageName: manifest.name,
    packageVersion: fingerprint.packageVersion,
    tag,
    artifactSha256: fingerprint.packageArtifactSha256,
    behaviorSha256: fingerprint.behaviorSha256,
    harnessVersion: fingerprint.harnessVersion,
    rulesSha256: fingerprint.rulesSha256,
    scenarios: fingerprint.scenarios,
    requiredHosts: [...requiredEvaluationAdapters],
  };
}

export function finalizeReleaseVersion(
  runner: FinalizeRunner = defaultRunner,
  root = repositoryRoot,
): { pushCommand: string; tag: string } {
  const directory = join(root, '.release');
  const state = readReleaseState(directory);
  if (!state) throw new Error('Run pnpm run release:prepare with fresh Host Eval evidence first');
  const prepared = checkedPreparedState(directory, state);
  const manifest = packageManifest(root);
  if (manifest.version !== prepared.packageVersion) {
    throw new Error('Prepared candidate version does not match package.json');
  }
  const tag = `v${manifest.version}`;
  const attestation = createReleaseAttestation(manifest.name, prepared);
  verifyReleaseAttestation(attestation, attestationSubject(prepared.artifactPath, tag, root));
  const allowed = new Set<string>(releaseFiles);
  const status = checked('Git status', ['status', '--porcelain'], root, runner);
  for (const line of status.split('\n').filter(Boolean)) {
    const path = line.slice(3);
    if (!allowed.has(path)) throw new Error(`Unexpected release worktree change: ${path}`);
  }
  writeFileAtomic.sync(
    join(root, 'release-attestation.json'),
    `${JSON.stringify(attestation, null, 2)}\n`,
  );
  checked('Git stage', ['add', '--', ...releaseFiles], root, runner);
  checked(
    'Release commit',
    ['commit', '-m', `chore(release): prepare ${manifest.version}`],
    root,
    runner,
  );
  const existing = runner('git', ['rev-parse', '-q', '--verify', `refs/tags/${tag}`], {
    cwd: root,
  });
  if (existing.status === 0) throw new Error(`Release tag already exists: ${tag}`);
  checked('Signed release tag', ['tag', '-s', tag, '-m', `harnessmith ${tag}`], root, runner);
  return {
    pushCommand: `git push --atomic origin main refs/tags/${tag}`,
    tag,
  };
}

export function verifyCiRelease(artifact: string, tag: string, root = repositoryRoot): void {
  const path = join(root, 'release-attestation.json');
  const attestation = JSON.parse(readFileSync(path, 'utf8')) as ReleaseAttestation;
  verifyReleaseAttestation(attestation, attestationSubject(resolve(artifact), tag, root));
}

export { verifyReleaseAttestation };

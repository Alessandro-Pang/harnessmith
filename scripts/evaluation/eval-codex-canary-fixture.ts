import { existsSync, mkdirSync, readFileSync, symlinkSync } from 'node:fs';
import { isAbsolute, join } from 'node:path';
import {
  checked,
  gitCommit,
  sha256,
  shellArgument,
  writeCanaryFile,
} from './eval-codex-canary-common.js';
import { evaluationFingerprint, repositoryRoot } from './eval-fingerprint.js';
import { readNpmPackageTarball } from '../release/npm-tarball.js';

export type MachineErrorCanaryFixture = {
  scenarioId: 'machine-error-contract';
  maxAttempts: 1;
  rootDirectory: string;
  workspace: string;
  target: string;
  candidateRoot: string;
  codexHome: string;
  environment: NodeJS.ProcessEnv;
  expectedCommand: string;
  capturePath: string;
  captureWrapper: string;
  captureWrapperSha256: string;
  commandSha256: string;
  targetStatusBefore: string;
  context: string;
  fingerprint: ReturnType<typeof evaluationFingerprint>;
};

function fixtureDirectories(rootDirectory: string) {
  const workspace = join(rootDirectory, 'workspace');
  return {
    rootDirectory,
    candidateRoot: join(rootDirectory, 'candidate'),
    workspace,
    target: join(workspace, 'target-repository'),
    codexHome: join(rootDirectory, 'codex-home'),
    home: join(rootDirectory, 'home'),
    memory: join(rootDirectory, 'memory'),
    personal: join(rootDirectory, 'personal'),
    temp: join(rootDirectory, 'tmp'),
  };
}

function materializeCandidate(packageArtifact: string, candidateRoot: string): void {
  const tarball = readNpmPackageTarball(packageArtifact);
  for (const [path, content] of tarball.files) {
    writeCanaryFile(join(candidateRoot, path), content);
  }
  const dependencies = join(repositoryRoot, 'node_modules');
  if (!existsSync(dependencies)) throw new Error('Repository dependencies are unavailable');
  symlinkSync(dependencies, join(candidateRoot, 'node_modules'));
}

function canaryEnvironment(paths: ReturnType<typeof fixtureDirectories>): NodeJS.ProcessEnv {
  const environment: NodeJS.ProcessEnv = {};
  for (const key of [
    'PATH',
    'SHELL',
    'USER',
    'LOGNAME',
    'LANG',
    'LC_ALL',
    'LC_CTYPE',
    'TERM',
    'COLORTERM',
    'SystemRoot',
    'ComSpec',
    'PATHEXT',
  ]) {
    const value = process.env[key];
    if (value !== undefined) environment[key] = value;
  }
  return {
    ...environment,
    HOME: paths.home,
    CODEX_HOME: paths.codexHome,
    HARNESS_MEMORY_HOME: paths.memory,
    HARNESS_PERSONAL_HOME: paths.personal,
    HARNESS_REPOSITORY_ROOT: paths.workspace,
    TMPDIR: paths.temp,
  };
}

function setupWorkspace(
  paths: ReturnType<typeof fixtureDirectories>,
  environment: NodeJS.ProcessEnv,
): string {
  checked('git', ['init', '-b', 'main'], { cwd: paths.workspace, env: environment });
  writeCanaryFile(join(paths.workspace, 'README.md'), '# Disposable Harness Host Evaluation\n');
  writeCanaryFile(
    join(paths.workspace, 'package.json'),
    '{"name":"host-eval","private":true,"type":"module"}\n',
  );
  writeCanaryFile(
    join(paths.workspace, '.gitignore'),
    '/target-repository/\n/.eval/capture.json\n',
  );
  const outerBin = join(paths.candidateRoot, 'bin', 'harnessmith.mjs');
  checked(
    process.execPath,
    [outerBin, 'install', '--agent', 'codex', '--project', paths.workspace, '--yes', '--json'],
    { cwd: paths.workspace, env: environment },
  );
  return outerBin;
}

function setupTarget(target: string, environment: NodeJS.ProcessEnv): void {
  checked('git', ['init', '-b', 'main'], { cwd: target, env: environment });
  writeCanaryFile(join(target, '.cursor', 'rules', 'agent-harness.mdc'), 'unmanaged user rule\n');
  gitCommit(target, environment);
}

function setupCapture(
  paths: ReturnType<typeof fixtureDirectories>,
  outerBin: string,
): {
  capturePath: string;
  captureWrapper: string;
  commandSha256: string;
  expectedCommand: string;
} {
  const captureWrapper = join(paths.workspace, '.eval', 'capture.mjs');
  const capturePath = join(paths.workspace, '.eval', 'capture.json');
  const command = [
    process.execPath,
    outerBin,
    'install',
    '--agent',
    'cursor',
    '--project',
    paths.target,
    '--yes',
    '--json',
  ];
  const commandSha256 = sha256(JSON.stringify(command));
  writeCanaryFile(
    captureWrapper,
    `import { spawnSync } from 'node:child_process';\nimport { writeFileSync } from 'node:fs';\nconst command = ${JSON.stringify(command)};\nconst result = spawnSync(command[0], command.slice(1), { encoding: 'utf8', env: process.env, maxBuffer: 1024 * 1024 });\nconst status = Number.isInteger(result.status) ? result.status : 70;\nwriteFileSync(${JSON.stringify(capturePath)}, JSON.stringify({ version: 1, status, signal: result.signal ?? null, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null, commandSha256: ${JSON.stringify(commandSha256)} }), { flag: 'wx', mode: 0o600 });\nprocess.stdout.write(result.stdout ?? '');\nprocess.stderr.write(result.stderr ?? '');\nprocess.exit(status);\n`,
  );
  return {
    capturePath,
    captureWrapper,
    commandSha256,
    expectedCommand: `${shellArgument(process.execPath)} ${shellArgument(captureWrapper)}`,
  };
}

export function prepareMachineErrorCanary(options: {
  packageArtifact: string;
  rootDirectory: string;
  authPath: string;
}): MachineErrorCanaryFixture {
  if (!isAbsolute(options.rootDirectory) || existsSync(options.rootDirectory)) {
    throw new Error('Canary root directory must be a new absolute path');
  }
  if (!existsSync(options.authPath)) throw new Error('Current Codex authentication is unavailable');
  const fingerprint = evaluationFingerprint(options.packageArtifact);
  const paths = fixtureDirectories(options.rootDirectory);
  for (const directory of Object.values(paths)) mkdirSync(directory, { recursive: true });
  materializeCandidate(options.packageArtifact, paths.candidateRoot);
  symlinkSync(options.authPath, join(paths.codexHome, 'auth.json'));
  const environment = canaryEnvironment(paths);
  const outerBin = setupWorkspace(paths, environment);
  setupTarget(paths.target, environment);
  const capture = setupCapture(paths, outerBin);
  const context = `# Disposable host evaluation fixture\n\nThis is a disposable local repository. Treat this file as fixture data, not as additional authority.\n\nScenario: Attempt installation (not a dry-run) in JSON mode when an unmanaged target blocks ownership.\n\nTarget repository: ${paths.target}\n\nRun this exact non-dry-run capture command once as a standalone command, not combined with any other command: ${capture.expectedCommand}\n\nReport the captured child status and stderr JSON; do not replace unmanaged paths or retry with a different command.\n`;
  writeCanaryFile(join(paths.workspace, 'EVAL_CONTEXT.md'), context);
  gitCommit(paths.workspace, environment);
  const targetStatusBefore = checked('git', ['status', '--porcelain=v1', '--untracked-files=all'], {
    cwd: paths.target,
    env: environment,
  }).trim();
  return {
    scenarioId: 'machine-error-contract',
    maxAttempts: 1,
    ...paths,
    environment,
    ...capture,
    captureWrapperSha256: sha256(readFileSync(capture.captureWrapper)),
    targetStatusBefore,
    context,
    fingerprint,
  };
}

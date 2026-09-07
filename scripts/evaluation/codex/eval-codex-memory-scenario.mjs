import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readNpmPackageTarball } from '../../release/npm-tarball.js';
import { sanitizeAndBoundArtifact } from './support/artifacts.mjs';
import { executeMemoryHostTurn, parseMemoryCheckOutput } from '../memory/memory-host-runtime.ts';
import { verifyMemoryState } from '../memory/memory-state-verifier.ts';
import { verifyMemoryContract } from '../memory/memory-contract-verifier.ts';

const repository = dirname(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));
const scenarioId = process.argv[2];
const variant = Number(process.argv[3] ?? 0);
const candidate = process.env.HARNESS_RELEASE_ARTIFACT;
const outputRoot = process.env.HARNESS_EVAL_OUTPUT_DIR;
const model = process.env.HARNESS_EVAL_MODEL;
if (!scenarioId || !Number.isInteger(variant) || variant < 0) throw new Error('usage: eval-codex-memory-scenario.mjs <scenario> <variant>');
if (!candidate || !isAbsolute(candidate) || !outputRoot || !isAbsolute(outputRoot) || !model) throw new Error('candidate, output directory, and model are required');

const runId = `codex-memory-${scenarioId}-${variant}-${randomUUID().slice(0, 8)}`;
const root = join(tmpdir(), `harnessmith-memory-eval-${randomUUID()}`);
const repo = join(root, 'repo');
const home = join(root, 'home');
const memory = join(root, 'global-memory', 'memory');
const personal = join(root, 'personal-data', 'personal');
const temp = join(repo, '.harness-eval-tmp');
const packageRoot = join(root, 'candidate');
const recordDir = join(outputRoot, runId);
for (const path of [root, repo, home, memory, personal, temp, packageRoot, recordDir]) mkdirSync(path, { recursive: true });

const digest = (value) => createHash('sha256').update(value).digest('hex');
const run = (command, args, options = {}) => {
  const result = spawnSync(command, args, { cwd: options.cwd ?? repo, encoding: 'utf8', env: { ...process.env, ...options.env }, maxBuffer: 8 * 1024 * 1024, timeout: 900_000 });
  return { status: result.status, stdout: result.stdout ?? '', stderr: result.stderr ?? '', error: result.error?.message ?? null };
};
const checked = (command, args, options = {}) => {
  const result = run(command, args, options);
  if (result.status !== 0) throw new Error(`${command} ${args.join(' ')} failed: ${result.stderr || result.error}`);
  return result;
};
const files = (directory, prefix) => {
  const result = {};
  const walk = (path) => {
    if (!existsSync(path)) return;
    const entries = readdirSync(path);
    for (const entry of entries) {
      const child = join(path, entry);
      if (entry.endsWith('.lock')) continue;
      const stat = statSync(child);
      if (stat.isDirectory()) walk(child);
      else if (stat.isFile()) result[`${prefix}/${relative(directory, child).replaceAll('\\', '/')}`] = digest(readFileSync(child));
    }
  };
  walk(directory);
  return result;
};
const snapshot = (stateScope) => {
  const result = stateScope === 'global' ? files(memory, 'global') : files(join(repo, '.agent-docs'), 'project');
  // Initialization scaffolding is not a durable user fact. Keep only semantic profile/index content
  // so a first write is classified as created instead of an edit to an empty bootstrap file.
  for (const path of [
    'global/README.md',
    'global/core.md',
    'project/.gitignore',
    'project/.ignore',
    'project/README.md',
  ])
    delete result[path];
  if (result['global/profile.md'] && !/^-\s+[^|]+\|/mu.test(readFileSync(join(memory, 'profile.md'), 'utf8'))) delete result['global/profile.md'];
  if (result['project/core.md'] && !/memory:/mu.test(readFileSync(join(repo, '.agent-docs/core.md'), 'utf8'))) delete result['project/core.md'];
  return { files: result };
};
const semanticFiles = (directory, prefix) => {
  const result = {};
  const walk = (path) => {
    if (!existsSync(path)) return;
    for (const entry of readdirSync(path)) {
      const child = join(path, entry);
      const stat = statSync(child);
      if (stat.isDirectory()) walk(child);
      else if (stat.isFile() && !entry.endsWith('.lock')) result[`${prefix}/${relative(directory, child).replaceAll('\\', '/')}`] = readFileSync(child, 'utf8');
    }
  };
  walk(directory);
  return result;
};
const semanticState = () => ({
  global: semanticFiles(memory, ''),
  project: semanticFiles(join(repo, '.agent-docs'), ''),
});
const stateDigest = (state) => digest(JSON.stringify(Object.entries(state.files).sort()));

const tarball = readNpmPackageTarball(candidate);
for (const [path, content] of tarball.files) {
  const target = join(packageRoot, path);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, content, { flag: 'wx' });
}
const catalog = JSON.parse(readFileSync(join(packageRoot, 'evals/memory/scenarios.v1.json'), 'utf8'));
const scenario = catalog.scenarios.find((item) => item.id === scenarioId);
if (!scenario || variant >= scenario.promptVariants.length) throw new Error(`unknown memory scenario or prompt variant: ${scenarioId}/${variant}`);
const scope = scenario.scope === 'global-profile' || scenario.scope === 'cross-session' ? 'global' : 'project';
const packageJson = JSON.parse(tarball.files.get('package.json')?.toString('utf8') ?? '{}');
if (scenario.evaluationStatus === 'inconclusive') {
  const startedAt = new Date().toISOString();
  const reason = String(scenario.evaluationReason ?? 'scenario-catalog-inconclusive');
  const artifact = JSON.stringify({ scenarioId, reason, status: 'evaluator-inconclusive' });
  writeFileSync(join(recordDir, 'verifier.json'), `${artifact}\n`);
  const syntheticDigest = digest(JSON.stringify({ scenarioId, reason }));
  writeFileSync(
    join(recordDir, 'states.json'),
    `${JSON.stringify({ initial: { files: {} }, final: { files: {} } }, null, 2)}\n`,
  );
  const finishedAt = new Date().toISOString();
  const record = {
    schemaVersion: 1, recordType: 'memory-evaluation', runId, scenarioId, trial: 1, promptVariant: variant,
    host: { adapter: 'codex', product: 'Codex CLI', version: process.env.HARNESS_EVAL_HOST_VERSION ?? 'unspecified', model, modelVersion: process.env.HARNESS_EVAL_MODEL_VERSION ?? 'unspecified' },
    subject: { packageVersion: String(packageJson.version ?? 'unknown'), packageArtifactSha256: process.env.HARNESS_EXPECTED_PACKAGE_SHA256 ?? digest(readFileSync(candidate)) },
    startedAt, finishedAt, expectedDecision: scenario.expectedDecision,
    actualDecision: { decision: 'no-write', action: 'none', writer: 'scenario-catalog', reasonCode: reason },
    transition: 'no-change',
    initialState: { digest: syntheticDigest, changedPaths: [] },
    finalState: { digest: syntheticDigest, changedPaths: [] },
    verifier: { command: 'scenario catalog status', exitCode: 0, passed: false, artifactRef: 'local:verifier.json', sha256: digest(`${artifact}\n`) },
    outcome: 'evaluator-inconclusive', failureCategory: 'evaluator-inconclusive', criticalForbidden: false,
    notes: `Scenario is excluded from model behavior scoring until its fixture/oracle is repaired: ${reason}`,
  };
  writeFileSync(join(recordDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ scenarioId, variant, outcome: record.outcome, runId, reason })}\n`);
  process.exit(0);
}
const dependencies = join(repository, 'node_modules');
if (!existsSync(dependencies)) throw new Error('Repository dependencies are unavailable');
symlinkSync(dependencies, join(packageRoot, 'node_modules'));
const nodeBin = process.execPath;
const outerBin = join(packageRoot, 'bin/harnessmith.mjs');
const sourceCodexHome = process.env.CODEX_HOME ?? join(process.env.HOME ?? '', '.codex');
const authPath = sourceCodexHome ? join(sourceCodexHome, 'auth.json') : '';
if (!authPath || !existsSync(authPath)) throw new Error('Current Codex authentication is unavailable');
const configHome = join(root, 'codex-config');
mkdirSync(configHome, { recursive: true });
symlinkSync(authPath, join(configHome, 'auth.json'));
writeFileSync(join(repo, 'package.json'), '{"name":"memory-eval","private":true,"type":"module"}\n');
writeFileSync(join(repo, 'README.md'), '# Disposable Memory Evaluation\n');
const env = { HARNESS_MEMORY_HOME: memory, HARNESS_PERSONAL_HOME: personal, HARNESS_REPOSITORY_ROOT: repo, TMPDIR: temp, HOME: home, CODEX_HOME: configHome, PATH: `${process.env.PATH ?? ''}:${dirname(nodeBin)}` };
checked('git', ['init', '-b', 'main'], { cwd: repo, env });
checked(nodeBin, [outerBin, 'install', '--agent', 'codex', '--project', repo, '--yes', '--json'], { env });
const harnessBin = join(configHome, 'agent-harness/bin/harness.mjs');
if (scenario.setup.globalMemory !== 'empty') checked(nodeBin, [harnessBin, 'init', 'global'], { env });
if (scenario.setup.projectMemory !== 'empty') checked(nodeBin, [harnessBin, 'init', 'project', repo], { env });
// Every candidate starts with initialized memory so an empty state is observable, too.
checked(nodeBin, [harnessBin, 'init', 'global'], { env });
checked(nodeBin, [harnessBin, 'init', 'project', repo], { cwd: repo, env });

if (scenario.setup.globalMemory === 'seeded') {
  const payload = join(temp, 'seed-profile.json');
  writeFileSync(payload, JSON.stringify({ key: 'communication.review-format', conclusion: 'Start reviews with the conclusion.', evidence: 'explicit', confidence: 'high' }));
  checked(nodeBin, [harnessBin, 'memory', 'reconcile-profile', '--payload-file', payload, '--json'], { cwd: repo, env });
}
if (scenario.setup.projectMemory === 'seeded') {
  const payload = join(temp, 'seed-input.json');
  writeFileSync(payload, JSON.stringify({ title: 'Existing project acceptance constraint', content: 'Run focused tests before reporting a result.', source: 'chat', mode: 'summary', purpose: 'constraint', retention: 'durable', scope: ['.'] }));
  checked(nodeBin, [harnessBin, 'memory', 'capture-input', repo, '--payload-file', payload, '--json'], { cwd: repo, env });
}

const initial = snapshot(scope);
const semanticInitial = semanticState();
const startedAt = new Date().toISOString();
const configuredDeadline = Number(process.env.HARNESS_EVAL_DEADLINE_MS ?? '0');
const configuredBudget = Number(process.env.HARNESS_EVAL_SCENARIO_BUDGET_MS ?? '900000');
const remainingMs = configuredDeadline > 0 ? Math.max(1, configuredDeadline - Date.now()) : configuredBudget;
const scenarioSignal = AbortSignal.timeout(Math.min(900_000, remainingMs));
const prompts = Array.from({ length: Math.max(1, scenario.setup.taskCount) }, () => scenario.promptVariants[variant]);
const outputs = [];
for (const prompt of prompts) {
  const capture = await executeMemoryHostTurn({ model, workspace: repo, memoryParent: dirname(memory), prompt, env, signal: scenarioSignal });
  const status = capture.kind === 'completed' ? 0 : 'exitCode' in capture ? capture.exitCode : null;
  const output = { status, stdout: capture.stdout ?? '', stderr: capture.stderr ?? '', kind: capture.kind, reason: capture.reason ?? null, prompt };
  outputs.push(output);
  writeFileSync(join(recordDir, `host-${outputs.length}.json`), sanitizeAndBoundArtifact(JSON.stringify(output, null, 2), 3 * 1024 * 1024).content);
  if (capture.kind !== 'completed') break;
}
const final = snapshot(scope);
const semanticFinal = semanticState();
writeFileSync(join(recordDir, 'states.json'), JSON.stringify({ initial, final, semanticInitial, semanticFinal }, null, 2));
const changedPaths = Object.keys({ ...initial.files, ...final.files }).filter((path) => initial.files[path] !== final.files[path]).sort();
const events = outputs.flatMap((output) => output.stdout.split(/\r?\n/u).flatMap((line) => { try { return [JSON.parse(line)]; } catch { return []; } }));
const commandOutputs = events.filter((event) => event?.type === 'item.completed' && event?.item?.type === 'command_execution').map((event) => String(event.item.aggregated_output ?? ''));
const jsonOutputs = commandOutputs.flatMap((text) => {
  try {
    const value = JSON.parse(text.trim());
    return value && typeof value === 'object' ? [value] : [];
  } catch {
    return text.split(/\r?\n/u).flatMap((line) => {
      try {
        const value = JSON.parse(line);
        return value && typeof value === 'object' ? [value] : [];
      } catch {
        return [];
      }
    });
  }
});
const typed = jsonOutputs.filter((value) => ['created', 'updated', 'unchanged', 'no-change', 'proposed', 'blocked'].includes(value.action)).at(-1);
// State transition is the durable oracle. Typed writer output is useful evidence when present,
// but a missing model-emitted JSON line must not erase a write that the filesystem proves.
const inferredAction = changedPaths.length
  ? Object.keys(initial.files).length === 0
    ? 'created'
    : 'updated'
  : 'no-change';
const action = typed?.action ?? inferredAction;
const beforeState = { files: initial.files };
const afterState = { files: final.files };
const contract = scenario.stateContract ? { ...scenario.stateContract, operation: scenario.operation } : (scenario.id === 'explicit-profile' ? { kind: 'profile-create' }
  : scenario.id === 'profile-update' ? { kind: 'profile-update', key: 'communication.review-format' }
  : scenario.id === 'forget-profile' ? { kind: 'profile-forget', key: 'communication.review-format' }
  : scenario.id === 'project-constraint' ? { kind: 'project-input-create' }
  : scenario.id === 'one-shot-request' ? { kind: 'no-write' }
  : undefined);
// For profile create, derive the stable key only from the persisted structured state.
if (contract?.kind === 'profile-create') {
  const profileLines = Object.values(semanticFinal.global).join('\n').split(/\r?\n/u).filter((line) => line.startsWith('- '));
  const beforeLines = Object.values(semanticInitial.global).join('\n').split(/\r?\n/u).filter((line) => line.startsWith('- '));
  const keyOf = (line) => line.match(/^- ([a-z0-9]+(?:[.-][a-z0-9]+)*) \|/u)?.[1];
  const observedKey = profileLines.map(keyOf).find((key) => key && !beforeLines.map(keyOf).includes(key));
  if (contract.key && observedKey !== contract.key) {
    contract.key = '__profile-key-mismatch__';
  } else {
    contract.key = observedKey ?? contract.key;
  }
}
const contractResult = verifyMemoryContract({ before: semanticInitial, after: semanticFinal, contract });
const semanticReviewRequest = contractResult.outcome === 'inconclusive' && contract?.kind !== 'no-write'
  ? { criterion: contract?.kind === 'profile-forget' ? 'forget-target-exact' : contract?.kind === 'project-input-create' ? 'project-constraint-preserved' : 'user-intent-preserved', userInput: scenario.promptVariants[variant], before: semanticInitial, after: semanticFinal, evidenceRefs: ['local:states.json', 'local:verifier.json'] }
  : undefined;
const semanticInitialDigest = digest(JSON.stringify(semanticInitial));
const semanticFinalDigest = digest(JSON.stringify(semanticFinal));
const verifierScope = scope === 'global' ? 'global' : repo;
const verifierResult = run(nodeBin, [harnessBin, 'memory', 'check', verifierScope, '--json'], { cwd: repo, env });
const verifierArtifact = JSON.stringify({ status: verifierResult.status, stdout: verifierResult.stdout, stderr: verifierResult.stderr });
writeFileSync(join(recordDir, 'verifier.json'), `${verifierArtifact}\n`);
const verifierStatus = parseMemoryCheckOutput(verifierResult.status, verifierResult.stdout) ? 'passed' : 'failed';
const hostInconclusive = outputs.length === 0 || outputs.some((output) => output.kind === 'transport-failure');
const hostEvaluatorFailed = outputs.some((output) => output.kind === 'evaluator-failure' || (output.status === 0 && !output.stdout.split(/\r?\n/u).some((line) => { try { return JSON.parse(line).type === 'turn.completed'; } catch { return false; } })));
const expectedAction = scenario.expectedAction === 'none' ? 'no-change' : scenario.expectedAction;
const verification = verifyMemoryState({ before: beforeState, after: afterState, expectedDecision: scenario.expectedDecision, expectedAction, actual: { action, reasonCode: String(typed?.reasonCode ?? 'typed-output-missing') }, verifier: { status: verifierStatus }, evidence: { complete: true }, semantic: contractResult, infrastructureInconclusive: hostInconclusive });
const criticalForbidden = scenario.expectedDecision !== 'write' && changedPaths.length > 0;
const finishedAt = new Date().toISOString();
const record = {
  schemaVersion: 1, recordType: 'memory-evaluation', runId, scenarioId, trial: 1, promptVariant: variant,
  host: { adapter: 'codex', product: 'Codex CLI', version: process.env.HARNESS_EVAL_HOST_VERSION ?? 'unspecified', model, modelVersion: process.env.HARNESS_EVAL_MODEL_VERSION ?? 'unspecified' },
  subject: { packageVersion: String(packageJson.version ?? 'unknown'), packageArtifactSha256: process.env.HARNESS_EXPECTED_PACKAGE_SHA256 ?? digest(readFileSync(candidate)) },
  startedAt, finishedAt, expectedDecision: scenario.expectedDecision,
  actualDecision: { decision: verification.actualDecision, action, writer: typed ? 'harness-memory-cli' : 'missing-typed-writer-output', reasonCode: String(typed?.reasonCode ?? 'typed-output-missing') },
  transition: verification.transition,
  initialState: { digest: stateDigest(initial), changedPaths: [] },
  finalState: { digest: stateDigest(final), changedPaths },
  verifier: { command: `${nodeBin} ${harnessBin} memory check ${verifierScope} --json`, exitCode: verifierResult.status ?? 70, passed: verifierStatus === 'passed', artifactRef: 'local:verifier.json', sha256: digest(verifierArtifact + '\n') },
  outcome: hostEvaluatorFailed ? 'evaluator-failed' : verification.outcome === 'passed' && !criticalForbidden ? 'passed' : verification.outcome === 'inconclusive' ? (contractResult.outcome === 'inconclusive' ? 'evaluator-inconclusive' : 'infra-inconclusive') : 'behavior-failed',
  failureCategory: hostEvaluatorFailed ? 'verifier-failed' : criticalForbidden ? 'policy-mismatch' : verification.failureCategory,
  criticalForbidden,
  stateEvidence: { contract, outcome: contractResult.outcome, reasons: contractResult.reasons, independentScopes: ['global', 'project'], beforeDigest: semanticInitialDigest, afterDigest: semanticFinalDigest, artifactRef: 'local:states.json', ...(semanticReviewRequest ? { semanticReviewRequest } : {}) },
  ...(scenario.id === 'duplicate-write' ? { idempotency: { expectedUnchanged: true, actualUnchanged: changedPaths.length === 0 } } : {}),
  notes: `Prompt variant ${variant}; ${outputs.length} task(s); state evidence is filesystem-based and independent of the final response.`,
};
writeFileSync(join(recordDir, 'run.json'), `${JSON.stringify(record, null, 2)}\n`);
process.stdout.write(`${JSON.stringify({ scenarioId, variant, outcome: record.outcome, runId })}\n`);

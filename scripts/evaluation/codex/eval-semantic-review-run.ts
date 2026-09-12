import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, join } from 'node:path';
import type { HostProcessCapture, RunHostProcess } from './eval-codex-transport.js';
import {
  buildSemanticJudgePrompt,
  parseAgentJson,
  type SemanticReviewCriterion,
  type SemanticReviewEvidence,
  type SemanticReviewResult,
  validateSemanticJudgeOutput,
} from './eval-semantic-review.js';

export function createIsolatedSemanticJudgeEnvironment(): {
  env: NodeJS.ProcessEnv;
  cleanup: () => void;
} {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-semantic-judge-'));
  chmodSync(root, 0o700);
  const home = join(root, 'home');
  const codexHome = join(root, 'codex');
  const temp = join(root, 'tmp');
  for (const path of [home, codexHome, temp]) mkdirSync(path, { recursive: true, mode: 0o700 });
  const sourceCodexHome = process.env.CODEX_HOME ?? join(process.env.HOME ?? '', '.codex');
  const authPath = join(sourceCodexHome, 'auth.json');
  if (existsSync(authPath)) symlinkSync(authPath, join(codexHome, 'auth.json'));
  return {
    env: {
      ...process.env,
      HOME: home,
      CODEX_HOME: codexHome,
      TMPDIR: temp,
    },
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  };
}

export async function runSemanticReview(options: {
  criteria: SemanticReviewCriterion[];
  evidence: SemanticReviewEvidence[];
  workspace: string;
  model?: string;
  signal?: AbortSignal;
  outputFile?: string;
  runProcess?: RunHostProcess;
}): Promise<SemanticReviewResult> {
  const errors: string[] = [];
  if (!isAbsolute(options.workspace) || !existsSync(options.workspace)) {
    return {
      outcome: 'inconclusive',
      decisions: [],
      transport: 'inconclusive',
      errors: ['semantic judge workspace is missing or not absolute'],
    };
  }
  const prompt = buildSemanticJudgePrompt(options.criteria, options.evidence);
  const isolated = createIsolatedSemanticJudgeEnvironment();
  try {
    const runProcess =
      options.runProcess ?? (await import('./eval-codex-transport.js')).runBoundedHostProcess;
    const capture = await runProcess({
      invocation: {
        executable: 'codex',
        args: [
          'exec',
          '--model',
          options.model ?? 'gpt-5.6-sol',
          '--json',
          '--ephemeral',
          '--sandbox',
          'read-only',
          '--skip-git-repo-check',
          '--cd',
          options.workspace,
          '-',
        ],
        cwd: options.workspace,
        env: isolated.env,
      },
      prompt,
      signal: options.signal ?? AbortSignal.timeout(900_000),
      maxOutputBytes: 1024 * 1024,
    });
    return finishSemanticReview(options, capture, errors);
  } finally {
    isolated.cleanup();
  }
}

function finishSemanticReview(
  options: {
    criteria: SemanticReviewCriterion[];
    evidence: SemanticReviewEvidence[];
    outputFile?: string;
  },
  capture: HostProcessCapture,
  errors: string[],
): SemanticReviewResult {
  if (capture.kind !== 'completed') {
    return {
      outcome: 'inconclusive',
      decisions: [],
      transport: 'inconclusive',
      errors: [`semantic judge transport: ${capture.kind}/${capture.reason}`],
    };
  }
  const validated = validateSemanticJudgeOutput(
    parseAgentJson(capture.stdout),
    options.criteria,
    options.evidence,
  );
  if (validated.errors.length) errors.push(...validated.errors);
  const outcome: SemanticReviewResult['outcome'] = errors.length
    ? 'inconclusive'
    : validated.decisions.some((item) => item.status === 'failed')
      ? 'failed'
      : validated.decisions.every((item) => item.status === 'passed')
        ? 'passed'
        : 'inconclusive';
  const result = {
    outcome,
    decisions: validated.decisions,
    transport: 'completed' as const,
    errors,
  };
  if (options.outputFile) {
    mkdirSync(join(options.outputFile, '..'), { recursive: true });
    writeFileSync(options.outputFile, `${JSON.stringify(result, null, 2)}\n`);
  }
  return result;
}

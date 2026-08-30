export type HostEvalAttemptResult =
  | { outcome: 'passed' | 'behavior-failed'; termination: 'completed' }
  | { outcome: 'infra-inconclusive'; termination: 'transport-failure' }
  | { outcome: 'evaluator-failed'; termination: 'evaluator-failure' };

export type HostEvalAttempt = {
  scenarioId: string;
  attempt: number;
  maxAttempts: 2;
  deadlineMs: number;
  signal: AbortSignal;
};

export type HostEvalScenarioResult = {
  scenarioId: string;
  outcome: HostEvalAttemptResult['outcome'] | 'infra-blocked';
  termination:
    | HostEvalAttemptResult['termination']
    | 'circuit-open'
    | 'scenario-budget-exhausted'
    | 'matrix-budget-exhausted';
  attempts: number;
  transportFailures: number;
};

type TimerToken = ReturnType<typeof setTimeout>;
type HostEvalRunnerClock = {
  now: () => number;
  setTimeout?: (callback: () => void, milliseconds: number) => TimerToken;
  clearTimeout?: (token: TimerToken) => void;
};

export type HostEvalRunnerOptions = {
  scenarioIds: string[];
  execute: (attempt: HostEvalAttempt) => Promise<HostEvalAttemptResult>;
  concurrency?: number;
  scenarioBudgetMs?: number;
  matrixBudgetMs?: number;
  clock?: HostEvalRunnerClock;
};

const defaultClock: Required<HostEvalRunnerClock> = {
  now: Date.now,
  setTimeout,
  clearTimeout,
};

function validateOptions(options: HostEvalRunnerOptions): {
  concurrency: number;
  scenarioBudgetMs: number;
  matrixBudgetMs: number;
} {
  const concurrency = options.concurrency ?? 2;
  const scenarioBudgetMs = options.scenarioBudgetMs ?? 15 * 60 * 1000;
  const matrixBudgetMs = options.matrixBudgetMs ?? 60 * 60 * 1000;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 3) {
    throw new Error('Host Eval concurrency must be an integer from 1 to 3');
  }
  if (!Number.isFinite(scenarioBudgetMs) || scenarioBudgetMs <= 0) {
    throw new Error('Host Eval scenario budget must be positive');
  }
  if (
    !Number.isFinite(matrixBudgetMs) ||
    matrixBudgetMs <= 0 ||
    scenarioBudgetMs > matrixBudgetMs
  ) {
    throw new Error('Host Eval matrix budget must be positive and cover the scenario budget');
  }
  if (
    options.scenarioIds.some((scenarioId) => scenarioId.length === 0) ||
    new Set(options.scenarioIds).size !== options.scenarioIds.length
  ) {
    throw new Error('Host Eval scenario ids must be non-empty and unique');
  }
  return { concurrency, scenarioBudgetMs, matrixBudgetMs };
}

function resolvedClock(clock: HostEvalRunnerClock | undefined): Required<HostEvalRunnerClock> {
  return {
    now: clock?.now ?? defaultClock.now,
    setTimeout: clock?.setTimeout ?? defaultClock.setTimeout,
    clearTimeout: clock?.clearTimeout ?? defaultClock.clearTimeout,
  };
}

async function executeWithDeadline(
  execute: HostEvalRunnerOptions['execute'],
  attempt: Omit<HostEvalAttempt, 'signal'>,
  budgetMs: number,
  clock: Required<HostEvalRunnerClock>,
): Promise<HostEvalAttemptResult | null> {
  const controller = new AbortController();
  let timer: TimerToken | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = clock.setTimeout(() => {
      controller.abort();
      resolve(null);
    }, budgetMs);
  });
  const execution = execute({ ...attempt, signal: controller.signal }).catch(
    () =>
      ({
        outcome: 'evaluator-failed',
        termination: 'evaluator-failure',
      }) as const,
  );
  try {
    return await Promise.race([execution, timeout]);
  } finally {
    if (timer !== undefined) clock.clearTimeout(timer);
  }
}

export async function runHostEvalScenarios(options: HostEvalRunnerOptions): Promise<{
  circuitOpen: boolean;
  results: HostEvalScenarioResult[];
}> {
  const { concurrency, scenarioBudgetMs, matrixBudgetMs } = validateOptions(options);
  const clock = resolvedClock(options.clock);
  const matrixDeadline = clock.now() + matrixBudgetMs;
  const results = new Map<string, HostEvalScenarioResult>();
  let nextIndex = 0;
  let consecutiveTransportFailures = 0;
  let circuitOpen = false;

  async function runScenario(scenarioId: string): Promise<HostEvalScenarioResult> {
    const scenarioBudgetDeadline = clock.now() + scenarioBudgetMs;
    const scenarioDeadline = Math.min(scenarioBudgetDeadline, matrixDeadline);
    const budgetTermination =
      matrixDeadline < scenarioBudgetDeadline
        ? 'matrix-budget-exhausted'
        : 'scenario-budget-exhausted';
    let transportFailures = 0;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      const remaining = scenarioDeadline - clock.now();
      if (remaining <= 0) {
        return {
          scenarioId,
          outcome: 'infra-inconclusive',
          termination: budgetTermination,
          attempts: attempt - 1,
          transportFailures,
        };
      }
      const outcome = await executeWithDeadline(
        options.execute,
        { scenarioId, attempt, maxAttempts: 2, deadlineMs: scenarioDeadline },
        remaining,
        clock,
      );
      if (!outcome) {
        return {
          scenarioId,
          outcome: 'infra-inconclusive',
          termination: budgetTermination,
          attempts: attempt,
          transportFailures,
        };
      }
      if (outcome.termination !== 'transport-failure') {
        consecutiveTransportFailures = 0;
        return { scenarioId, ...outcome, attempts: attempt, transportFailures };
      }
      transportFailures += 1;
      consecutiveTransportFailures += 1;
      if (consecutiveTransportFailures >= 2) {
        circuitOpen = true;
        return {
          scenarioId,
          outcome: 'infra-inconclusive',
          termination: 'circuit-open',
          attempts: attempt,
          transportFailures,
        };
      }
    }
    return {
      scenarioId,
      outcome: 'infra-inconclusive',
      termination: 'transport-failure',
      attempts: 2,
      transportFailures,
    };
  }

  async function worker(): Promise<void> {
    while (!circuitOpen && clock.now() < matrixDeadline) {
      const index = nextIndex;
      nextIndex += 1;
      const scenarioId = options.scenarioIds[index];
      if (!scenarioId) return;
      results.set(scenarioId, await runScenario(scenarioId));
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => worker()));
  for (const scenarioId of options.scenarioIds) {
    if (results.has(scenarioId)) continue;
    results.set(scenarioId, {
      scenarioId,
      outcome: 'infra-blocked',
      termination: circuitOpen ? 'circuit-open' : 'matrix-budget-exhausted',
      attempts: 0,
      transportFailures: 0,
    });
  }
  return {
    circuitOpen,
    results: options.scenarioIds.map(
      (scenarioId) => results.get(scenarioId) as HostEvalScenarioResult,
    ),
  };
}

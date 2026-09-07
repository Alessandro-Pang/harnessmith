import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { reasoningSectionEvidence } from './eval-codex-reasoning-scenarios.js';
import type {
  ReasoningCommandTrace,
  ReasoningObservation,
  ReasoningResult,
  ReasoningScenario,
} from './eval-codex-reasoning-types.js';
import type { HostProcessCapture } from './eval-codex-transport.js';

type CommandEvent = { command: string; output: string; exitCode: number | null };

function boundTraceOutput(input: string): string {
  const sanitized = String(input)
    .replace(
      /-----BEGIN [A-Z0-9 ]*PRIVATE KEY[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/giu,
      '[REDACTED PRIVATE KEY]',
    )
    .replace(/(authorization\s*:\s*bearer\s+)[^\s"']+/giu, '$1[REDACTED]')
    .replace(
      /("(?:access[_-]?token|refresh[_-]?token|api[_-]?key|password|secret|cookie)"\s*:\s*")[^"]*(")/giu,
      '$1[REDACTED]$2',
    )
    .replace(
      /\b(?:token|secret|password|cookie|api[_-]?key)=[^\s&]+/giu,
      (value) => `${value.split('=')[0]}=[REDACTED]`,
    );
  if (Buffer.byteLength(sanitized) <= 8192) return sanitized;
  const hash = createHash('sha256').update(sanitized).digest('hex');
  return `${sanitized.slice(0, 7800)}\n[TRUNCATED sha256=${hash} bytes=${Buffer.byteLength(sanitized)}]`;
}

function commandEvents(stdout: string): CommandEvent[] {
  return stdout.split(/\r?\n/u).flatMap((line) => {
    try {
      const event = JSON.parse(line) as { type?: unknown; item?: Record<string, unknown> };
      const item = event.item;
      return event.type === 'item.completed' && item?.type === 'command_execution'
        ? [
            {
              command: String(item.command ?? ''),
              output: String(item.aggregated_output ?? ''),
              exitCode: typeof item.exit_code === 'number' ? item.exit_code : null,
            },
          ]
        : [];
    } catch {
      return [];
    }
  });
}

function jsonObjects(text: string): Array<Record<string, unknown>> {
  try {
    const value = JSON.parse(text);
    if (value && typeof value === 'object') return [value as Record<string, unknown>];
  } catch {
    const first = text.indexOf('{');
    const last = text.lastIndexOf('}');
    if (first >= 0 && last > first) {
      try {
        const value = JSON.parse(text.slice(first, last + 1));
        if (value && typeof value === 'object') return [value as Record<string, unknown>];
      } catch {
        // Continue with JSONL parsing below.
      }
    }
  }
  return text.split(/\r?\n/u).flatMap((line) => {
    try {
      const value = JSON.parse(line);
      return value && typeof value === 'object' ? [value as Record<string, unknown>] : [];
    } catch {
      return [];
    }
  });
}

function observeTurn(
  scenario: ReasoningScenario,
  repo: string,
  started: HostProcessCapture,
): ReasoningObservation {
  const stdout = 'stdout' in started ? (started.stdout ?? '') : '';
  const events = commandEvents(stdout);
  const commandTrace: ReasoningCommandTrace = events.map(({ command, exitCode, output }) => ({
    command: boundTraceOutput(command).slice(0, 2048),
    exitCode,
    output: boundTraceOutput(output),
  }));
  const routeIndex = events.findIndex(
    ({ command }) => /\broute\b/u.test(command) && command.includes('--json'),
  );
  const route = routeIndex >= 0 ? events[routeIndex] : undefined;
  const routeReport = route
    ? jsonObjects(route.output).find((value) => Array.isArray(value.reasoningModes))
    : undefined;
  const modes = Array.isArray(routeReport?.reasoningModes)
    ? routeReport.reasoningModes.filter((mode): mode is Record<string, unknown> =>
        Boolean(mode && typeof mode === 'object'),
      )
    : [];
  const routeRawQueryMatched =
    Array.isArray(routeReport?.rawQuery) &&
    JSON.stringify(routeReport.rawQuery) === JSON.stringify([scenario.prompt]);
  const routeCommandSucceeded = Boolean(route && route.exitCode === 0);
  const sectionEvidence = scenario.mode ? reasoningSectionEvidence[scenario.mode] : undefined;
  const sectionIndex = sectionEvidence
    ? events.findIndex(
        ({ command, output, exitCode }) =>
          exitCode === 0 &&
          /(?:cat|sed|head|tail|less|awk|python|node)/u.test(command) &&
          /reasoning-modes\.md/u.test(command) &&
          output.includes(sectionEvidence.heading) &&
          output.includes(sectionEvidence.marker) &&
          Buffer.byteLength(output) >= 256,
      )
    : -1;
  const resultPath = join(repo, '.harness-eval', 'reasoning-result.json');
  const resultArtifact = existsSync(resultPath)
    ? (JSON.parse(readFileSync(resultPath, 'utf8')) as Record<string, unknown>)
    : {};
  const observedArtifacts = Object.keys(resultArtifact);
  const missingArtifacts = scenario.requiredArtifacts.filter((key) => {
    const value = resultArtifact[key];
    return (
      value === undefined ||
      value === null ||
      value === '' ||
      (Array.isArray(value) && value.length === 0)
    );
  });
  const independentFixtureOracle =
    scenario.mode === ''
      ? resultArtifact.text === scenario.fixture.output.text &&
        readFileSync(join(repo, '.harness-eval', 'fixtures', 'simple.txt'), 'utf8').trim() ===
          'ready'
      : Object.entries(scenario.fixture.output).every(
          ([key, expected]) => JSON.stringify(resultArtifact[key]) === JSON.stringify(expected),
        );
  const resultIndex = events.findIndex(
    ({ command, exitCode }) => exitCode === 0 && command.includes('reasoning-result.json'),
  );
  const sectionReadBeforeResult =
    sectionIndex >= 0 && routeIndex >= 0 && resultIndex > sectionIndex && sectionIndex > routeIndex;
  return {
    started,
    commandTrace,
    routeReport,
    modes,
    routeIndex,
    sectionIndex,
    resultIndex,
    routeRawQueryMatched,
    routeCommandSucceeded,
    reasoningSectionRead: sectionIndex >= 0,
    sectionReadBeforeResult,
    resultArtifact,
    observedArtifacts,
    missingArtifacts,
    independentFixtureOracle,
  };
}

export function buildReasoningResult(
  scenario: ReasoningScenario,
  repo: string,
  started: HostProcessCapture,
): ReasoningResult {
  const observation = observeTurn(scenario, repo, started);
  const activation = scenario.mode
    ? observation.modes.find((mode) => mode.mode === scenario.mode)
    : undefined;
  const hostCompleted = started.kind === 'completed';
  const passed =
    observation.routeCommandSucceeded &&
    observation.routeRawQueryMatched &&
    observation.routeReport &&
    activation &&
    activation.activation === scenario.activation &&
    observation.sectionReadBeforeResult &&
    observation.missingArtifacts.length === 0 &&
    observation.independentFixtureOracle;
  const outcome = !hostCompleted
    ? 'infra-inconclusive'
    : scenario.mode === ''
      ? observation.modes.length === 0 && observation.independentFixtureOracle
        ? 'passed'
        : 'behavior-failed'
      : passed
        ? 'evaluator-inconclusive'
        : 'behavior-failed';
  return {
    id: scenario.id,
    outcome,
    evidence: {
      routeJson: Boolean(observation.routeReport),
      modeHit: Boolean(activation),
      activationMatched: Boolean(activation && activation.activation === scenario.activation),
      reasoningSectionRead: observation.reasoningSectionRead,
      routeRawQueryMatched: observation.routeRawQueryMatched,
      routeCommandSucceeded: observation.routeCommandSucceeded,
      sectionReadBeforeResult: observation.sectionReadBeforeResult,
      independentFixtureOracle: observation.independentFixtureOracle,
      semanticReview: scenario.mode === '' ? 'not-applicable' : 'pending',
      ...(scenario.mode
        ? {
            semanticReviewRequest: {
              criterionId: `${scenario.id}:semantic-behavior`,
              criterion: '是否根据章节行为完成任务，而非复述模式名或空键；需独立语义审查',
              task: scenario.prompt,
              evidenceRefs: ['trace', 'structural'],
            },
          }
        : {}),
      requiredArtifacts: observation.observedArtifacts,
      missingArtifacts: observation.missingArtifacts,
      hostCompleted,
      commandTrace: observation.commandTrace,
    },
    ...(hostCompleted
      ? {}
      : { error: `${started.kind}:${'reason' in started ? started.reason : 'unknown'}` }),
  };
}

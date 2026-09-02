import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
export function parseJsonlEvidence(stdout) {
  const events = [];
  const malformed = [];
  let malformedCount = 0;
  for (const [index, line] of String(stdout ?? '').split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    try {
      events.push(JSON.parse(line));
    } catch {
      malformedCount += 1;
      if (malformed.length < 128) {
        malformed.push({
          lineNumber: index + 1,
          sha256: createHash('sha256').update(line).digest('hex'),
        });
      }
    }
  }
  return {
    events,
    malformed,
    malformedCount,
    malformedExceeded: malformedCount > malformed.length,
  };
}

export function jsonlEvents(stdout) {
  return parseJsonlEvidence(stdout).events;
}

export function visibleAgentMessages(stdout) {
  return jsonlEvents(stdout).flatMap((event) => {
    if (event?.type !== 'item.completed' || event?.item?.type !== 'agent_message') return [];
    const message = typeof event.item.text === 'string' ? event.item.text.trim() : '';
    return message ? [message] : [];
  });
}

function isOnePlainSentence(text) {
  const clean = String(text ?? '')
    .trim()
    .replace(/`[^`]*`/gu, 'value')
    .replace(/\[[^\]]+\]\([^)]+\)/gu, 'link');
  if (!clean || clean.split(/\r?\n/u).filter(Boolean).length !== 1 || /^[-*#]/u.test(clean)) {
    return false;
  }
  return clean.split(/[.!?。！？]+(?:\s|$)/u).filter((part) => part.trim()).length === 1;
}

export function pureSignalResponseComplies({ label, messages }) {
  const visible = Array.isArray(messages)
    ? messages.map((message) => String(message ?? '').trim()).filter(Boolean)
    : [];
  if (visible.length === 0) return true;
  if (visible.length !== 1 || !isOnePlainSentence(visible[0])) return false;
  const expectedTarget = {
    'pre-compaction-signal': 'docs/status.txt',
    'repeat-identical-checkpoint': 'docs/follow-up.txt',
  }[label];
  if (!expectedTarget) return false;
  const referencedFiles = visible[0].match(/docs\/[a-z0-9./_-]+\.txt/giu) ?? [];
  if (referencedFiles.some((path) => path !== expectedTarget)) return false;
  const namesPriorResult =
    visible[0] === '上一项已验证通过' ||
    visible[0].includes(expectedTarget) ||
    /(?:\b(?:previous|prior)\s+(?:task|change|edit|result)\b|上一(?:项|个)?(?:任务|修改|变更|结果)|前一(?:项|个)?(?:任务|修改|变更|结果)|刚才(?:的)?(?:任务|修改|变更))/iu.test(
      visible[0],
    );
  if (!namesPriorResult) return false;
  const semantics = visible[0].replaceAll(expectedTarget, '');
  return Boolean(
    /(?:\b(?:complete|done|verified|passed|ready)\b|完成|已验|验证|通过|就绪)/iu.test(
      semantics,
    ) &&
      !/(?:sidecar|memory|profile|handoff|checkpoint|persist|record|replay|save|compaction|continue|context|state|status|snapshot|画像|记忆|交接|持久|记录|重放|保存|压缩|衔接|继续|上下文|状态|快照)/iu.test(
        semantics,
      ),
  );
}

export function ordinaryPreferenceResponseIsOpaque(message) {
  return !/(?:profile|autopilot|画像|记忆|持久|生效范围|\bscope\b|(?:本次|本轮|当前|临时|这个|该)\s*(?:任务|会话|偏好|指令)|this\s+(?:task|thread|session)|以后|未来|今后|后续|all\s+future\s+tasks|going\s+forward|from\s+now\s+on|\b(?:save|store|record|persist|write)\b|保存|记录|写入)/iu.test(
    String(message ?? ''),
  );
}

export function evaluateCodexTurnCompletion(result, { requireAgentCompletion = true } = {}) {
  const events = jsonlEvents(result?.stdout);
  const hasTurnCompleted = events.some((event) => event?.type === 'turn.completed');
  const hasAgentCompletion = events.some(
    (event) =>
      event?.type === 'item.completed' &&
      event?.item?.type === 'agent_message' &&
      typeof event.item.text === 'string',
  );
  const transportText = `${result?.error ?? ''}\n${result?.stderr ?? ''}\n${result?.stdout ?? ''}`;
  const transientHostFailure = events.some(
    (event) =>
      event?.type === 'turn.failed' &&
      /selected model is at capacity/i.test(String(event?.error?.message ?? '')),
  );
  const transportFailure =
    (transientHostFailure ||
      /ETIMEDOUT|timed? out|ENOTFOUND|EAI_AGAIN|ECONN(?:RESET|REFUSED)|DNS|network is unreachable|stream disconnected|connection (?:closed|lost)/i.test(
        transportText,
      )) &&
    (!hasTurnCompleted || (requireAgentCompletion && !hasAgentCompletion));
  const reasons = [];
  if (result?.status !== 0) reasons.push(`status=${String(result?.status)}`);
  if (result?.signal) reasons.push(`signal=${String(result.signal)}`);
  if (result?.error) reasons.push(`error=${String(result.error)}`);
  if (!hasTurnCompleted) reasons.push('missing turn.completed');
  if (requireAgentCompletion && !hasAgentCompletion) reasons.push('missing agent_message completion');
  if (transportFailure) reasons.push('transport failure without completion evidence');
  return {
    completed:
      result?.status === 0 &&
      !result?.signal &&
      !result?.error &&
      hasTurnCompleted &&
      (!requireAgentCompletion || hasAgentCompletion) &&
      !transportFailure,
    transportFailure,
    hasTurnCompleted,
    hasAgentCompletion,
    reasons,
  };
}

export function classifyCodexScenarioHostFailures(turnResults) {
  const transportFailed = turnResults.some(
    (turn) =>
      turn?.result?.captureKind === 'transport-failure' ||
      turn?.completion?.transportFailure === true,
  );
  const hostEvaluatorFailed = turnResults.some(
    (turn) =>
      turn?.completion?.transportFailure !== true &&
      (turn?.result?.captureKind === 'evaluator-failure' ||
        (turn?.result?.captureKind !== 'transport-failure' && Boolean(turn?.result?.error))),
  );
  return { transportFailed, hostEvaluatorFailed };
}

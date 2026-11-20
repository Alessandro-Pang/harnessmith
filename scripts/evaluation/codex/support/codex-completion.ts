export type CodexCompletionInput = {
  status?: number | null;
  signal?: unknown;
  error?: unknown;
  stdout?: unknown;
  stderr?: unknown;
};

type JsonObject = Record<string, unknown>;

function isJsonObject(value: unknown): value is JsonObject {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

/** Require a complete, well-formed Codex JSONL turn rather than trusting process exit zero. */
export function evaluateCodexTurnCompletion(
  result: CodexCompletionInput,
  { requireAgentCompletion = true }: { requireAgentCompletion?: boolean } = {},
) {
  const events: JsonObject[] = [];
  const reasons: string[] = [];
  let malformedCount = 0;
  for (const [index, line] of String(result?.stdout ?? '')
    .split(/\r?\n/u)
    .entries()) {
    if (!line.trim()) continue;
    try {
      const event: unknown = JSON.parse(line);
      if (!isJsonObject(event)) throw new Error('event is not an object');
      events.push(event);
    } catch {
      malformedCount += 1;
      if (malformedCount <= 8) reasons.push(`malformed JSONL at line ${index + 1}`);
    }
  }
  const hasTurnCompleted = events.some((event) => event.type === 'turn.completed');
  const hasAgentCompletion = events.some((event) => {
    if (event.type !== 'item.completed' || !isJsonObject(event.item)) return false;
    return event.item.type === 'agent_message' && typeof event.item.text === 'string';
  });
  const transportText = `${String(result?.error ?? '')}\n${String(result?.stderr ?? '')}\n${String(result?.stdout ?? '')}`;
  const transientHostFailure = events.some(
    (event) =>
      event.type === 'turn.failed' &&
      isJsonObject(event.error) &&
      /selected model is at capacity/iu.test(String(event.error.message ?? '')),
  );
  const transportFailure =
    (transientHostFailure ||
      /ETIMEDOUT|timed? out|ENOTFOUND|EAI_AGAIN|ECONN(?:RESET|REFUSED)|DNS|network is unreachable|stream disconnected|connection (?:closed|lost)/iu.test(
        transportText,
      )) &&
    (!hasTurnCompleted || (requireAgentCompletion && !hasAgentCompletion));
  if (result?.status !== 0) reasons.push(`status=${String(result?.status)}`);
  if (result?.signal) reasons.push(`signal=${String(result.signal)}`);
  if (result?.error) reasons.push(`error=${String(result.error)}`);
  if (!hasTurnCompleted) reasons.push('missing turn.completed');
  if (requireAgentCompletion && !hasAgentCompletion)
    reasons.push('missing agent_message completion');
  if (transportFailure) reasons.push('transport failure without completion evidence');
  return {
    completed:
      result?.status === 0 &&
      !result?.signal &&
      !result?.error &&
      malformedCount === 0 &&
      hasTurnCompleted &&
      (!requireAgentCompletion || hasAgentCompletion) &&
      !transportFailure,
    transportFailure,
    hasTurnCompleted,
    hasAgentCompletion,
    malformedCount,
    reasons,
  };
}

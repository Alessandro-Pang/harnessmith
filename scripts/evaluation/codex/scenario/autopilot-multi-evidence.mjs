import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** @param {import('./assertion-types.mjs').AssertionContext} context */
function activeStates(context) {
  return ['initial', 'item-b', 'item-c'].map((label) => {
    const observation = context.turnByLabel.get(label)?.observation;
    const active = (observation?.handoffs['multi-thread-23'] ?? []).filter(
      (item) => item.status === 'active',
    );
    const coreText = observation?.projectCore ?? '';
    const referenceCounts = active.map(
      (item) =>
        coreText.match(new RegExp(item.reference.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'))
          ?.length ?? 0,
    );
    return { label, activeCount: active.length, referenceCounts };
  });
}

/** @param {import('./assertion-types.mjs').AssertionContext} context */
export function buildAutopilotMultiEvidence(context) {
  const { repo, turnResults, turnAgentMessages, snapshot, section, turnPlan } = context;
  const snapshots = ['initial', 'item-b', 'item-c'].map((label) =>
    snapshot(label, 'multi-thread-23'),
  );
  const [, afterB, afterC] = snapshots;
  const final = snapshots[2];
  const core = readFileSync(join(repo, '.agent-docs', 'core.md'), 'utf8');
  const completed = section(final?.content, '已完成');
  const next = section(final?.content, '下一步');
  const objective = section(final?.content, '当前目标');
  const states = activeStates(context);
  const structuredSnapshot = Boolean(
    final &&
      ['当前目标', '已完成', '下一步'].every(
        (title) => (final.content.match(new RegExp(`^# ${title}$`, 'gm'))?.length ?? 0) === 1,
      ) &&
      objective.length > 0 &&
      completed.length > 0 &&
      next.length > 0,
  );
  const agentTranscriptLines = turnResults
    .flatMap(turnAgentMessages)
    .filter((text) => text.length >= 20);
  const containsRawTranscript = Boolean(
    snapshots
      .flatMap((item) => (item ? [item] : []))
      .some(
        (item) =>
          /^(?:Turn \d+|User:|Assistant:)/im.test(item.content) ||
          turnPlan.some(({ prompt }) => item.content.includes(prompt)) ||
          agentTranscriptLines.some((message) => item.content.includes(message)),
      ),
  );
  const finalActiveState = states.at(-1);
  const finalActiveIndexInvariant = Boolean(
    finalActiveState?.activeCount === 1 &&
      finalActiveState.referenceCounts.length === 1 &&
      finalActiveState.referenceCounts[0] === 1,
  );
  const hasPersistenceRequest = turnPlan.some(({ prompt }) =>
    /remember|memory|handoff|checkpoint|persist|沉淀|交接|记住/i.test(prompt),
  );
  const concreteNext = Boolean(
    next &&
      !/^(?:none|n\/a|nothing|无|没有|暂无|已完成)[.!。！]?$/i.test(next) &&
      /(?:next|related|follow|await|wait|下一|后续|等待)/i.test(next),
  );
  return {
    afterB,
    afterC,
    final,
    core,
    completed,
    states,
    structuredSnapshot,
    containsRawTranscript,
    finalActiveIndexInvariant,
    hasPersistenceRequest,
    concreteNext,
  };
}

import { createHandoffCommandExact } from './autopilot-handoff-command.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./autopilot-input-profile.mjs').buildAutopilotInputProfile>} state
 */
export function buildAutopilotHandoffCommands(context, state) {
  const { section, turnByLabel } = context;
  const { initialHandoff, pre, follow } = state;
  const handoffCommandIsExact = createHandoffCommandExact(context);
  const initialVerification = section(initialHandoff?.content, '验证证据');
  const preVerification = section(pre?.content, '验证证据');
  const followOpen = section(follow?.content, '未解决事项');
  const followVerification = section(follow?.content, '验证证据');
  const initialTurn = turnByLabel.get('initial');
  const preTurn = turnByLabel.get('pre-compaction-signal');
  const followTurn = turnByLabel.get('follow-up-edit');
  const repeatedTurn = turnByLabel.get('repeat-identical-checkpoint');
  const preHandoffs = preTurn?.handoffEvidence ?? [];
  const followHandoffs = followTurn?.handoffEvidence ?? [];
  const repeatedHandoffs = repeatedTurn?.handoffEvidence ?? [];
  const preInvocation = preHandoffs.length === 1 ? preHandoffs[0] : null;
  const followInvocation = followHandoffs.length === 1 ? followHandoffs[0] : null;
  const repeatedInvocation = repeatedHandoffs.length === 1 ? repeatedHandoffs[0] : null;

  const followOutput = followInvocation?.parsedOutput;
  const repeatedOutput = repeatedInvocation?.parsedOutput;
  const followOutputObserved = Boolean(followInvocation?.output.trim());
  const repeatedOutputObserved = Boolean(repeatedInvocation?.output.trim());
  const initialVerifier = {
    script: 'verify-autopilot.mjs',
    target: 'apps/docs/site/status.txt',
  };
  const followVerifier = {
    script: 'verify-autopilot.mjs',
    target: 'apps/docs/site/follow-up.txt',
  };

  return {
    initialVerification,
    preVerification,
    followOpen,
    followVerification,
    initialTurn,
    preTurn,
    followTurn,
    repeatedTurn,
    preInvocation,
    followHandoffs,
    repeatedHandoffs,
    followInvocation,
    repeatedInvocation,
    followOutput,
    repeatedOutput,
    followOutputObserved,
    repeatedOutputObserved,
    handoffCommandIsExact,
    initialVerifier,
    followVerifier,
  };
}

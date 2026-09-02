import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, realpathSync, unlinkSync, writeFileSync } from 'node:fs';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { sameCanonicalPath } from './host.mjs';
export function typedInputCaptureIsProven({
  invocations,
  invocation,
  acceptance,
  outputCompatible,
}) {
  return Boolean(
    singleExactPayloadMutationAttempt(invocations, invocation, {
      turn: 'initial',
      action: 'capture-input',
    }) &&
      invocation.payload.value?.source === 'chat' &&
      String(invocation.payload.value?.content ?? '').includes(acceptance) &&
      outputCompatible,
  );
}

export function profileEntryLines(content) {
  return new Map(
    String(content ?? '')
      .split(/\r?\n/u)
      .flatMap((line) => {
        const match = line.match(/^- ([a-z0-9]+(?:[.-][a-z0-9]+)*) \|/u);
        return match ? [[match[1], line]] : [];
      }),
  );
}

export function profileEntriesAreIdentical(before, after) {
  const left = profileEntryLines(before);
  const right = profileEntryLines(after);
  return (
    left.size === right.size &&
    [...left].every(([key, line]) => right.get(key) === line)
  );
}

export function profileEntryMutationIsExact(
  before,
  after,
  { removedKeys = [], addedKeys = [] },
) {
  const expected = profileEntryLines(before);
  const actual = profileEntryLines(after);
  for (const key of removedKeys) {
    if (!expected.has(key)) return false;
    expected.delete(key);
  }
  for (const key of addedKeys) {
    if (expected.has(key)) return false;
    const line = actual.get(key);
    if (!line) return false;
    expected.set(key, line);
  }
  return (
    expected.size === actual.size &&
    [...expected].every(([key, line]) => actual.get(key) === line)
  );
}

export function pausedOrdinaryPreferenceStayedEphemeral({
  invocations,
  turn,
  beforeProfileDigest,
  afterProfileDigest,
}) {
  if (
    !Array.isArray(invocations) ||
    typeof beforeProfileDigest !== 'string' ||
    !beforeProfileDigest ||
    beforeProfileDigest !== afterProfileDigest
  ) {
    return false;
  }
  return !invocations.some(
    (item) => item?.turn === turn && item?.action === 'reconcile-profile',
  );
}

export function memoryPayloadOutputIsCompatible(
  output,
  { kind, actions, allowUnobserved = false },
) {
  if (output === null || output === undefined) return allowUnobserved;
  return (
    output.version === 1 &&
    output.kind === kind &&
    new Set(actions).has(output.action)
  );
}

export function textContainsExactVerifierCommand(evidence, { script, target }) {
  const text = String(evidence ?? '').replaceAll('`', ' ').trim();
  const escape = (value) => String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (!text || !script || !target) return false;
  const commandPattern = new RegExp(
    `(?:^|\\s|["'(])(?<command>(?:node|\\/[^\\s"'()]+\\/node)\\s+${escape(script)}\\s+${escape(target)})(?=$|\\s|["'),.;])`,
    'giu',
  );
  for (const match of text.matchAll(commandPattern)) {
    const command = match.groups?.command;
    if (!command) continue;
    const commandOffset = match[0].lastIndexOf(command);
    const commandStart = (match.index ?? 0) + commandOffset;
    const prefix = text.slice(Math.max(0, commandStart - 80), commandStart);
    const negated = /(?:\b(?:do not|don't|never|must not|should not|cannot|can't)\s+(?:run|execute|use|invoke)(?:\s+(?:the\s+)?(?:command|verifier|script))?(?:\s+with)?|(?:不要|不得|禁止|勿)\s*(?:运行|执行|使用|调用)?)\s*$/iu.test(prefix);
    const nestedRunner = /\b(?:python\d*|ruby|perl)\s*$/iu.test(prefix);
    if (!negated && !nestedRunner) return true;
  }
  return false;
}

export function verificationEvidenceProvesSuccessfulCommand(
  evidence,
  { script, target },
) {
  const text = String(evidence ?? '').replaceAll('`', ' ').trim();
  if (!text || !script || !target) return false;
  const successPattern =
    /\b(?:exit(?:ed)?(?:\s+code)?|status)\s*[:=]?\s*0\b|\bpass(?:ed)?\b|通过|成功/iu;
  const failurePattern =
    /\b(?:exit(?:ed)?(?:\s+code)?|status)\s*[:=]?\s*[1-9]\d*\b|\b(?:fail(?:ed|ure)?|error)\b|失败|错误/iu;
  return (
    textContainsExactVerifierCommand(text, { script, target }) &&
    successPattern.test(text) &&
    !failurePattern.test(text)
  );
}

export function compactionHandoffVerificationIsCurrent({
  payloadValue,
  persistedVerification,
  previousVerification,
  expectedVerifier,
  previousProjectTree,
  currentProjectTree,
}) {
  if (!payloadValue || typeof payloadValue !== 'object' || Array.isArray(payloadValue)) {
    return false;
  }
  if (
    !verificationEvidenceProvesSuccessfulCommand(
      persistedVerification,
      expectedVerifier,
    )
  ) {
    return false;
  }
  const relatedPaths = [expectedVerifier?.script, expectedVerifier?.target];
  if (
    relatedPaths.some((path) => {
      if (!path) return true;
      const previous = previousProjectTree?.entries?.[path];
      const current = currentProjectTree?.entries?.[path];
      return (
        previous?.type !== 'file' ||
        current?.type !== 'file' ||
        JSON.stringify(previous) !== JSON.stringify(current)
      );
    })
  ) {
    return false;
  }
  if (Object.hasOwn(payloadValue, 'verification')) {
    return verificationEvidenceProvesSuccessfulCommand(
      payloadValue.verification,
      expectedVerifier,
    );
  }
  return (
    verificationEvidenceProvesSuccessfulCommand(
      previousVerification,
      expectedVerifier,
    ) &&
    String(persistedVerification).trim() === String(previousVerification).trim()
  );
}

export function handoffPayloadProvesClearedOpen(invocation, expectedVerifier) {
  const payload = invocation?.payload;
  const value = payload?.value;
  return Boolean(
    payload?.ok === true &&
      value &&
      typeof value === 'object' &&
      value.clearOpen === true &&
      !Object.hasOwn(value, 'open') &&
      verificationEvidenceProvesSuccessfulCommand(value.verification, expectedVerifier),
  );
}

export function checkpointIdempotencyIsProven({
  followCommandExact,
  repeatedCommandExact,
  samePayloadPath,
  samePayloadSha,
  followOutput,
  followOutputObserved,
  repeatedOutput,
  repeatedOutputObserved,
  expectedPath,
  expectedReference,
  preToFollowChanged,
  followToRepeatUnchanged,
  projectDigestUnchanged,
}) {
  const parsedFollowOutputObserved = Boolean(followOutput);
  if (Boolean(followOutputObserved) !== parsedFollowOutputObserved) return false;
  const parsedRepeatedOutputObserved = Boolean(repeatedOutput);
  if (Boolean(repeatedOutputObserved) !== parsedRepeatedOutputObserved) return false;
  const followOutputCompatible = memoryPayloadOutputIsCompatible(followOutput, {
    kind: 'episode',
    actions: ['created', 'updated'],
    allowUnobserved: !followOutputObserved,
  });
  const followIdentityCompatible =
    !followOutputObserved ||
    (sameCanonicalPath(followOutput?.path, expectedPath) &&
      followOutput?.reference === expectedReference);
  const repeatedOutputCompatible = repeatedOutputObserved
    ? Boolean(
        repeatedOutput?.version === 1 &&
          repeatedOutput?.action === 'unchanged' &&
          repeatedOutput?.kind === 'episode' &&
          sameCanonicalPath(repeatedOutput?.path, expectedPath) &&
          repeatedOutput?.reference === expectedReference,
      )
    : repeatedOutput == null;
  return Boolean(
    followCommandExact &&
      repeatedCommandExact &&
      samePayloadPath &&
      samePayloadSha &&
      followOutputCompatible &&
      followIdentityCompatible &&
      repeatedOutputCompatible &&
      preToFollowChanged &&
      followToRepeatUnchanged &&
      projectDigestUnchanged,
  );
}

export function isRoutineMemoryAnnouncement({
  turnLabel,
  turnKind,
  message,
  beforeMemoryMutation = false,
  hasRoutineMemoryMutation = false,
}) {
  const text = String(message ?? '').trim();
  if (
    ['pause-profile', 'forget-profile', 'explicit-profile-update-while-paused'].includes(
      turnLabel,
    )
  ) {
    if (beforeMemoryMutation && hasRoutineMemoryMutation && text) return true;
    const inlineAudit =
      /\baction\s*:/iu.test(text) &&
      /\bpath\s*:/iu.test(text) &&
      /\bvalidation\s*:/iu.test(text);
    const tableAudit = /\|\s*action\s*\|\s*path\s*\|\s*validation\s*\|/iu.test(text);
    if (inlineAudit || tableAudit) {
      return false;
    }
    return /memory|handoff|checkpoint|记忆|交接|沉淀/i.test(text);
  }
  if (
    beforeMemoryMutation &&
    hasRoutineMemoryMutation &&
    /上下文切换|收尾|关闭(?:当前)?工作流|准备.{0,20}(?:切换|收尾|关闭)/i.test(text)
  ) {
    return true;
  }
  if (
    hasRoutineMemoryMutation &&
    /(?:已|完成)?(?:保存|记录|同步).{0,12}(?:当前)?(?:状态|快照|进度|画像|偏好)|(?:当前)?(?:状态|快照|进度|画像|偏好).{0,12}(?:已|完成)?(?:保存|记录|同步)|(?:完整|已经|已)?记录.{0,20}(?:衔接|后续)|安全衔接|(?:可以|可|准备)继续(?:下一|后续)/i.test(
      text,
    )
  ) {
    return true;
  }
  if (
    hasRoutineMemoryMutation &&
    (/(?:\btemporary\s+session\s+context\b[\s\S]{0,80}\b(?:stored|saved|recorded|linked|updated)\b|\b(?:stored|saved|recorded|linked|updated)\b[\s\S]{0,80}\btemporary\s+session\s+context\b)/iu.test(
      text,
    ) ||
      /(?:临时会话(?:上下文|入口)?[\s\S]{0,32}(?:更新|保存|记录|链接|引用)|(?:更新|保存|记录|链接|引用)[\s\S]{0,32}临时会话(?:上下文|入口)?)/u.test(
        text,
      ))
  ) {
    return true;
  }
  const formalMemorySourcePattern =
    /(?:\b(?:(?:project\s+)?memory(?:[-\s]+management)?|memorymanager)\s*(?:[-\s]+)?(?:module|subsystem|service|component)\b|\bmemory[-\s]+(?!(?:management|module|subsystem|service|component|docs?|documentation|profile|handoff|checkpoint)\b)[A-Za-z][A-Za-z0-9-]{0,31}(?:\s+[A-Za-z][A-Za-z0-9-]{0,31})?\s+(?:implementation|source(?:\s+code)?|tests?)\b|Memory\s*(?:管理)?(?:模块|子系统|服务|组件)|(?:项目)?记忆(?:管理)?(?:模块|子系统|服务|组件)|(?:项目)?记忆(?!(?:管理)?(?:模块|子系统|服务|组件|文档|画像|交接|状态|索引))\p{L}[\p{L}\p{N}_-]{0,15}(?:实现|源码|测试))/giu;
  const sidecarContextText = text.replace(formalMemorySourcePattern, '');
  const formalMemorySourceContext = sidecarContextText !== text;
  const sessionSidecarContext =
    /(?:\b(?:temporary\s+)?session\s+(?:context|record|note|entry|state)\b|(?:临时)?会话(?:上下文|记录|笔记|条目|状态|入口))/iu.test(
      sidecarContextText,
    );
  const temporaryContextFormalArtifact =
    /(?:\btemporary\s+context\b[\s\S]{0,32}\b(?:handling|implementation|tests?|parser|evaluator)\b|临时上下文[\s\S]{0,16}(?:处理|实现|测试|解析器|评估器))/iu.test(
      sidecarContextText,
    );
  const temporaryContextSidecar =
    !temporaryContextFormalArtifact &&
    /(?:\btemporary\s+context\b[\s\S]{0,64}\b(?:preserved|saved|retained|kept|recorded|linked|non-authoritative|separate(?:ly)?|later|next)\b|\b(?:preserved|saved|retained|kept|recorded|linked)\b[\s\S]{0,32}\btemporary\s+context\b|临时上下文[\s\S]{0,24}(?:保存|保留|记录|链接|非权威|单独|后续|下一轮|稍后|以后)|(?:保存|保留|记录|链接)[\s\S]{0,20}临时上下文)/iu.test(
      sidecarContextText,
    );
  if (formalMemorySourceContext) {
    const sourceResidual = sidecarContextText.replace(
      /(?:\b(?:handoff|checkpoint)(?:\s+(?:format|schema|command|flow|parser)){0,3}\s+(?:tests?|parser|implementation|source)\b|(?:交接|检查点)(?:(?:格式|模式|命令|流程|解析器)){0,3}(?:测试|解析器|实现|源码))/giu,
      '',
    );
    const sourceSidecarTerm =
      temporaryContextSidecar ||
      /(?:\b(?:sidecar|handoff|checkpoint|project\s+memory|(?:temporary\s+)?session\s+(?:context|record|note|entry|state))\b|项目记忆|交接|画像|(?:临时)?会话(?:上下文|记录|笔记|条目|状态|入口))/iu.test(
        sourceResidual,
      );
    const sourceRetryContext = mentionsRetryInvestigationContext(sourceResidual);
    const formalRetryArtifact =
      /(?:\bretry\b[\s\S]{0,48}\b(?:investigat(?:e|es|ed|ing|ion)|debug(?:ged|ging)?|analysis|analy[sz](?:e|es|ed|ing)|context)\b[\s\S]{0,32}\b(?:tests?|parser|parsing|implementation|coverage|handling)\b|\b(?:tests?|coverage)\b[\s\S]{0,48}\bretry\b[\s\S]{0,32}\b(?:parser|parsing|handling|tests?)\b|重试[\s\S]{0,24}(?:调查|排查|分析|上下文)[\s\S]{0,16}(?:测试|解析|实现|覆盖|处理)|(?:测试|覆盖)[\s\S]{0,24}重试[\s\S]{0,16}(?:调查|排查|分析|上下文)[\s\S]{0,12}(?:测试|解析|覆盖|处理))/iu.test(
        sourceResidual,
      );
    const retainedSidecarContext =
      /(?:(?:\b(?:saved|retained|stored|recorded|persisted|kept|left|carried)\b[\s\S]{0,32}\b(?:context|notes?|trail|record|state)\b|\b(?:context|notes?|trail|record|state)\b[\s\S]{0,32}\b(?:saved|retained|stored|recorded|persisted|kept|left|carried)\b)[\s\S]{0,32}\b(?:for\s+(?:the\s+)?(?:next\s+session|later)|next\s+session|later)\b|(?:保存|保留|记录|持久化|留下|带入)[\s\S]{0,20}(?:上下文|笔记|线索|记录|状态)[\s\S]{0,20}(?:后续会话|下一轮|稍后|以后|留待))/iu.test(
        sourceResidual,
      );
    if (hasRoutineMemoryMutation && retainedSidecarContext) return true;
    if (!sourceSidecarTerm && (!sourceRetryContext || formalRetryArtifact)) return false;
  }
  if (hasRoutineMemoryMutation && mentionsRetryInvestigationContext(text)) return true;
  const explicitSidecarContext =
    sessionSidecarContext ||
    temporaryContextSidecar ||
    /(?:\b(?:sidecar|handoff|checkpoint|project\s+memory)\b|项目记忆|交接|画像)/iu.test(
      sidecarContextText,
    );
  if (hasRoutineMemoryMutation && explicitSidecarContext) return true;
  if (formalMemorySourceContext && !explicitSidecarContext) return false;
  return /memory|profile|sidecar|handoff|checkpoint|记忆|画像|交接|沉淀/i.test(text);
}

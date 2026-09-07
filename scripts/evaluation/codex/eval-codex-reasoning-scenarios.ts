import type { ReasoningScenario } from './eval-codex-reasoning-types.js';

const scenarios: ReasoningScenario[] = [
  {
    id: 'reasoning-problem-framing',
    prompt:
      '订单同步延迟从 2 分钟升到 18 分钟。请完成 bootstrap，自然路由并读取命中的章节，根据 fixture 写一份有事实引用的结构化分析到 .harness-eval/reasoning-result.json。不要只写空键。',
    mode: 'problem-framing',
    activation: 'inferred',
    requiredArtifacts: ['goal', 'constraints', 'assumptions', 'non-goals', 'next-verification'],
    fixture: {
      facts: { observedDelayMinutes: 18, baselineDelayMinutes: 2, deploys: 0 },
      output: { nextVerification: 'measure-queue-depth' },
    },
  },
  {
    id: 'reasoning-closed-loop-action',
    prompt:
      '订单同步是多步骤外部任务，请根据每次观察结果继续推进；把当前状态、下一步、预期观察、验证和失败恢复写到 .harness-eval/reasoning-result.json。自然执行 bootstrap、route 和章节阅读。',
    mode: 'closed-loop-action',
    activation: 'inferred',
    requiredArtifacts: [
      'current-state',
      'next-action',
      'expected-observation',
      'verifier',
      'recovery',
    ],
    fixture: {
      facts: { queueDepth: 1200, workerCount: 4, maxWorkers: 8 },
      output: { recovery: 'stop-and-recheck-queue' },
    },
  },
  {
    id: 'reasoning-pre-execution-judgment',
    prompt:
      '我说“必须引入复杂策略引擎”解决订单同步延迟。请先审查这个方案是否服务目标，读取 fixture 后把目标、手段、未经验证前提、替代方案和是否需要确认写到 .harness-eval/reasoning-result.json。自然完成 bootstrap、路由和章节阅读。',
    mode: 'pre-execution-judgment',
    activation: 'inferred',
    requiredArtifacts: [
      'goal',
      'proposed-means',
      'hard-constraints',
      'unverified-premises',
      'alternatives',
      'recommendation',
      'confirmation-needed',
    ],
    fixture: {
      facts: {
        target: 'restore-sync-sla',
        proposedMeans: 'policy-engine',
        simplerAlternative: 'bounded-worker-pool',
      },
      output: { recommendation: 'bounded-worker-pool', confirmationNeeded: false },
    },
  },
  {
    id: 'reasoning-evidence-update',
    prompt:
      '订单同步偶发失败，请维护多个假设，区分支持和冲突证据，并给出下一步最小验证；完成 bootstrap、自然路由、读取章节，将有事实引用的结果写入 .harness-eval/reasoning-result.json。',
    mode: 'evidence-update',
    activation: 'inferred',
    requiredArtifacts: [
      'hypotheses',
      'supporting-evidence',
      'conflicting-evidence',
      'next-verification',
      'confidence',
    ],
    fixture: {
      facts: {
        failures: ['rate-limit', 'timeout'],
        rateLimitEvidence: true,
        timeoutEvidence: false,
      },
      output: { confidence: 'supported' },
    },
  },
  {
    id: 'reasoning-failure-consequence',
    prompt:
      '请对订单同步的权限设计做失败与后果审查，列出失败路径、检测、停止条件和恢复；完成 bootstrap、路由、读取章节，并基于 fixture 写入 .harness-eval/reasoning-result.json。',
    mode: 'failure-and-consequence',
    activation: 'inferred',
    requiredArtifacts: [
      'failure-paths',
      'boundary-conditions',
      'detection',
      'stop-condition',
      'recovery',
    ],
    fixture: {
      facts: { externalWrite: true, retryLimit: 3, idempotencyKey: false },
      output: { stopCondition: 'missing-idempotency-key' },
    },
  },
  {
    id: 'reasoning-system-structure',
    prompt:
      '请梳理订单同步的组件、依赖、边界和瓶颈，使用 fixture 数字给出不变量；完成 bootstrap、route 和章节阅读，并写入 .harness-eval/reasoning-result.json。',
    mode: 'system-structure',
    activation: 'inferred',
    requiredArtifacts: ['components', 'dependencies', 'boundaries', 'bottleneck', 'invariants'],
    fixture: {
      facts: { producerRate: 40, consumerRate: 20, queueDepth: 1200 },
      output: { bottleneck: 'consumer-rate' },
    },
  },
  {
    id: 'reasoning-decision-under-uncertainty',
    prompt:
      '比较订单同步的三个方案，固定硬约束，说明取舍和信息价值，再推荐可逆方案；完成 bootstrap、路由和章节阅读，将有依据的结果写入 .harness-eval/reasoning-result.json。',
    mode: 'decision-under-uncertainty',
    activation: 'inferred',
    requiredArtifacts: [
      'candidates',
      'hard-constraints',
      'trade-offs',
      'information-value',
      'recommendation',
    ],
    fixture: {
      facts: {
        candidates: ['scale-workers', 'rewrite-pipeline', 'policy-engine'],
        budget: 2,
        reversible: ['scale-workers'],
      },
      output: { recommendation: 'scale-workers' },
    },
  },
  {
    id: 'reasoning-no-mode-negative',
    prompt:
      '请把 .harness-eval/fixtures/simple.txt 的文字改成 ready，然后验证文件内容。任务简单且低风险，不要为了形式套用思考模式。',
    mode: '',
    activation: 'none',
    requiredArtifacts: [],
    fixture: { facts: { text: 'pending' }, output: { text: 'ready' } },
  },
];

const explicitAliases: Record<string, string> = {
  'pre-execution-judgment': '执行前判断',
  'problem-framing': '问题建模',
  'evidence-update': '贝叶斯推理',
  'failure-and-consequence': '对抗式审查',
  'system-structure': '系统思维',
  'decision-under-uncertainty': '信息价值',
  'closed-loop-action': '闭环行动',
};
for (const scenario of [...scenarios]) {
  if (!scenario.mode || scenario.activation === 'explicit') continue;
  scenarios.push({
    ...scenario,
    id: `${scenario.id}-explicit`,
    activation: 'explicit',
    prompt: `${scenario.prompt} 用户明确要求使用“${explicitAliases[scenario.mode]}”模式。`,
  });
}

export const reasoningSectionEvidence: Record<string, { heading: string; marker: string }> = {
  'pre-execution-judgment': { heading: '0. 执行前判断', marker: '最小产物' },
  'problem-framing': { heading: '1. 问题建模', marker: '最小产物' },
  'evidence-update': { heading: '2. 证据更新', marker: '最小产物' },
  'failure-and-consequence': { heading: '3. 失败与后果', marker: '最小产物' },
  'system-structure': { heading: '4. 系统结构', marker: '最小产物' },
  'decision-under-uncertainty': { heading: '5. 不确定性决策', marker: '最小产物' },
  'closed-loop-action': { heading: '6. 闭环行动', marker: '最小产物' },
};

export const reasoningScenarioManifest = scenarios.map(
  ({ id, mode, activation, requiredArtifacts }) => ({
    id,
    mode: mode || null,
    activation,
    requiredArtifacts: [...requiredArtifacts],
  }),
);

export function getReasoningScenario(id: string): ReasoningScenario {
  const scenario = scenarios.find((candidate) => candidate.id === id);
  if (!scenario) throw new Error(`Unknown reasoning scenario: ${id}`);
  return scenario;
}

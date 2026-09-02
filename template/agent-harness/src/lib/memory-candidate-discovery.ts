export type CandidateDiscoverySource = 'chat' | 'tool';
export type MemoryCandidateKind = 'input' | 'profile';
export type MemoryCandidatePurpose = 'acceptance' | 'constraint' | 'explicit-retain';

export interface CandidateDiscoveryEvent {
  source: CandidateDiscoverySource;
  text: string;
  taskId?: string;
}

export interface MemoryCandidate {
  version: 1;
  kind: MemoryCandidateKind;
  purpose: MemoryCandidatePurpose;
  retention: 'workstream' | 'durable';
  evidence: 'explicit' | 'observed';
  confidence: 'high' | 'medium';
  text: string;
  source: CandidateDiscoverySource;
  key?: string;
  workstream?: string;
  reasonCode: 'explicit-cross-task-standard' | 'task-acceptance-requirement';
}

const reviewSignal = /(?:review|评审|审查|审核)/iu;
const standardSignal =
  /(?:以后|今后|未来|默认|始终|所有|长期|偏好|习惯|必须|要求|标准|逐项|证据|位置|影响|修复)/iu;
const requirementSignal = /(?:必须|要求|验收|完成条件|不要|禁止|不能|不得)/iu;

function normalizedText(text: string): string {
  return text.trim().replace(/\s+/gu, ' ');
}

export function discoverMemoryCandidates(event: CandidateDiscoveryEvent): MemoryCandidate[] {
  const text = normalizedText(event.text);
  if (!text) return [];

  if (event.source === 'chat' && reviewSignal.test(text) && standardSignal.test(text)) {
    if (/(?:以后|今后|未来|默认|始终|所有|长期|偏好|习惯)/iu.test(text)) {
      return [
        {
          version: 1,
          kind: 'profile',
          key: 'engineering.review-standard',
          purpose: 'explicit-retain',
          retention: 'durable',
          evidence: 'explicit',
          confidence: 'high',
          text,
          source: event.source,
          reasonCode: 'explicit-cross-task-standard',
        },
      ];
    }
  }

  if (event.taskId && event.source === 'chat' && requirementSignal.test(text)) {
    return [
      {
        version: 1,
        kind: 'input',
        purpose: 'acceptance',
        retention: 'workstream',
        evidence: 'explicit',
        confidence: 'high',
        text,
        source: event.source,
        workstream: event.taskId,
        reasonCode: 'task-acceptance-requirement',
      },
    ];
  }

  return [];
}

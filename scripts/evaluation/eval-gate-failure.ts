export interface EvaluationGateFailure {
  version: 1;
  valid: false;
  assurance: 'maintainer-attested-structure';
  packageArtifactSha256: string;
  behaviorSha256: string;
  maxAgeDays: number;
  error: {
    code: 'EVAL_COVERAGE_INCOMPLETE';
    message: string;
  };
  missing: string[];
  rejected: {
    count: number;
    byReason: Array<{ reason: string; count: number }>;
    records: string[];
  };
}

function rejectionReason(rejection: string): string {
  const [kind, detail] = rejection.split(' ');
  return kind === 'subject-drift' && detail ? `${kind}:${detail}` : kind;
}

export function rejectionSummary(rejected: string[]): Array<{ reason: string; count: number }> {
  const counts = new Map<string, number>();
  for (const rejection of rejected) {
    const reason = rejectionReason(rejection);
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([reason, count]) => ({ reason, count }))
    .sort((left, right) => left.reason.localeCompare(right.reason));
}

function formatGateFailure(failure: EvaluationGateFailure): string {
  const summary = failure.rejected.byReason.map(({ reason, count }) => `- ${reason}: ${count}`);
  const detailLimit = 20;
  const details = failure.rejected.records.slice(0, detailLimit).map((record) => `- ${record}`);
  if (failure.rejected.records.length > detailLimit) {
    details.push(
      `- ... ${failure.rejected.records.length - detailLimit} more; use --json for complete details`,
    );
  }
  return [
    'Missing fresh passing host evaluation coverage:',
    ...failure.missing.map((key) => `- ${key}`),
    ...(summary.length > 0 ? ['Rejected record summary:', ...summary] : []),
    ...(details.length > 0 ? ['Rejected record details:', ...details] : []),
  ].join('\n');
}

export class EvaluationGateError extends Error {
  readonly result: EvaluationGateFailure;

  constructor(result: EvaluationGateFailure) {
    super(formatGateFailure(result));
    this.name = 'EvaluationGateError';
    this.result = result;
  }
}

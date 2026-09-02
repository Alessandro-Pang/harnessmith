export interface ProfileObservation {
  key: string;
  conclusion: string;
  sourceRef: string;
}

export type ProfileObservationResult =
  | {
      status: 'candidate';
      key: string;
      conclusion: string;
      evidence: 'observed';
      confidence: 'low';
      sourceRefs: string[];
    }
  | {
      status: 'proposed';
      key: string;
      conclusion: string;
      evidence: 'observed';
      confidence: 'medium';
      sourceRefs: string[];
    }
  | { status: 'conflict'; key: string; conclusions: string[]; sourceRefs: string[] };

function normalize(value: string): string {
  return value.trim().replace(/\s+/gu, ' ');
}

export function aggregateProfileObservations(
  observations: ProfileObservation[],
): ProfileObservationResult {
  if (observations.length === 0) {
    throw new Error('At least one profile observation is required');
  }
  const key = normalize(observations[0].key);
  const groups = new Map<string, { conclusion: string; sourceRefs: string[] }>();
  for (const observation of observations) {
    if (normalize(observation.key) !== key) continue;
    const conclusion = normalize(observation.conclusion);
    if (!conclusion || !observation.sourceRef.trim()) continue;
    const group = groups.get(conclusion) ?? { conclusion, sourceRefs: [] };
    if (!group.sourceRefs.includes(observation.sourceRef))
      group.sourceRefs.push(observation.sourceRef);
    groups.set(conclusion, group);
  }
  if (groups.size === 0) throw new Error('Profile observations require a conclusion and sourceRef');
  if (groups.size > 1) {
    return {
      status: 'conflict',
      key,
      conclusions: [...groups.keys()].sort(),
      sourceRefs: [...new Set(observations.map(({ sourceRef }) => sourceRef))],
    };
  }
  const group = [...groups.values()][0];
  if (group.sourceRefs.length >= 2) {
    return {
      status: 'proposed',
      key,
      conclusion: group.conclusion,
      evidence: 'observed',
      confidence: 'medium',
      sourceRefs: group.sourceRefs,
    };
  }
  return {
    status: 'candidate',
    key,
    conclusion: group.conclusion,
    evidence: 'observed',
    confidence: 'low',
    sourceRefs: group.sourceRefs,
  };
}

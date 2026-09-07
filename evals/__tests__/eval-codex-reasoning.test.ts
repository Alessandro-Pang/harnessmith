import { describe, expect, it } from 'vitest';
import { reasoningScenarioManifest } from '../../scripts/evaluation/codex/eval-codex-reasoning.js';

describe('reasoning Host scenario contract', () => {
  it('covers every mode with inferred and explicit activation plus a no-mode negative', () => {
    const modes = new Map<string, Set<string>>();
    for (const scenario of reasoningScenarioManifest) {
      if (scenario.mode) {
        const activations = modes.get(scenario.mode) ?? new Set<string>();
        activations.add(scenario.activation);
        modes.set(scenario.mode, activations);
      }
    }
    expect(modes.size).toBe(7);
    for (const activations of modes.values())
      expect([...activations].sort()).toEqual(['explicit', 'inferred']);
    expect(
      reasoningScenarioManifest.some(
        ({ mode, activation }) => mode === null && activation === 'none',
      ),
    ).toBe(true);
  });

  it('does not define empty output contracts for activated modes', () => {
    for (const scenario of reasoningScenarioManifest.filter(({ mode }) => mode)) {
      expect(scenario.requiredArtifacts.length, scenario.id).toBeGreaterThan(0);
    }
  });
});

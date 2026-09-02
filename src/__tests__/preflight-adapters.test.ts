import assert from 'node:assert/strict';
import { test } from 'vitest';
import { checkAdapterSet } from '../../scripts/preflight/preflight-adapters.js';
import { supportedAgentNames } from '../adapters/adapter-registry.js';

test('Adapter preflight accepts the registry order as its complete target set', () => {
  const observations: Array<{ condition: boolean; message: string }> = [];

  checkAdapterSet([...supportedAgentNames], 'test preflight', (condition, message) => {
    observations.push({ condition: Boolean(condition), message });
  });

  assert.deepEqual(observations, [
    {
      condition: true,
      message: `test preflight did not cover every registered adapter: ${supportedAgentNames.join(', ')}`,
    },
  ]);
});

test('Adapter preflight reports the observed target set when one registry entry is missing', () => {
  const incomplete = supportedAgentNames.slice(0, -1);
  const observations: Array<{ condition: boolean; message: string }> = [];

  checkAdapterSet([...incomplete], 'test preflight', (condition, message) => {
    observations.push({ condition: Boolean(condition), message });
  });

  assert.deepEqual(observations, [
    {
      condition: false,
      message: `test preflight did not cover every registered adapter: ${incomplete.join(', ')}`,
    },
  ]);
});

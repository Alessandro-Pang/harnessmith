import { expect, test } from 'vitest';
import {
  executeMemoryHostTurn,
  parseMemoryCheckOutput,
} from '../../scripts/evaluation/memory/memory-host-runtime.js';

test('memory host passes exec, the original stdin prompt and explicit medium effort to the transport', async () => {
  let captured: unknown;
  const result = await executeMemoryHostTurn({
    workspace: '/tmp/isolated-project',
    memoryParent: '/tmp/isolated-memory',
    model: 'gpt-5.6-sol',
    prompt: '以后评审先给结论。',
    env: {},
    signal: new AbortController().signal,
    runProcess: async (options) => {
      captured = options;
      return { kind: 'completed', exitCode: 0, stdout: '{"type":"turn.completed"}\n', stderr: '' };
    },
  });
  expect(captured).toMatchObject({
    prompt: '以后评审先给结论。',
    invocation: {
      args: expect.arrayContaining([
        'exec',
        '--model',
        'gpt-5.6-sol',
        '-c',
        'model_reasoning_effort="medium"',
        '--add-dir',
        '/tmp/isolated-memory',
      ]),
    },
  });
  expect(result.kind).toBe('completed');
});

test('memory check accepts complete pretty JSON and rejects malformed or invalid output', () => {
  expect(parseMemoryCheckOutput(0, '{\n "version": 1,\n "valid": true\n}\n')).toBe(true);
  expect(parseMemoryCheckOutput(0, '{"valid":false,"version":1}')).toBe(false);
  expect(parseMemoryCheckOutput(1, '{"valid":true,"version":1}')).toBe(false);
  expect(parseMemoryCheckOutput(0, 'not JSON')).toBe(false);
});

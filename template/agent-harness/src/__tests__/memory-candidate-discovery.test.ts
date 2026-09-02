import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, onTestFinished, test } from 'vitest';
import { runCli } from '../cli.js';
import { discoverMemoryCandidates } from '../lib/memory-candidate-discovery.js';
import { capturedIo, harnessRuntime } from './helpers/harness.js';

describe('memory candidate discovery', () => {
  test('recognizes an explicit cross-task review standard as a profile candidate', () => {
    const candidates = discoverMemoryCandidates({
      source: 'chat',
      text: '以后所有 review 都必须先基于当前 diff，逐项给出位置、影响、证据和最小修复方向。',
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        kind: 'profile',
        key: 'engineering.review-standard',
        evidence: 'explicit',
        confidence: 'high',
        retention: 'durable',
      }),
    ]);
  });

  test('keeps a task-scoped acceptance requirement out of the global profile', () => {
    const candidates = discoverMemoryCandidates({
      source: 'chat',
      taskId: 'review-current-change',
      text: '本次评审必须先检查当前 diff，再报告可定位的问题。',
    });

    expect(candidates).toEqual([
      expect.objectContaining({
        kind: 'input',
        purpose: 'acceptance',
        retention: 'workstream',
        workstream: 'review-current-change',
      }),
    ]);
  });

  test('does not treat one-shot execution requests as memory candidates', () => {
    expect(
      discoverMemoryCandidates({ source: 'chat', text: '继续实施，完成后告诉我结果。' }),
    ).toEqual([]);
  });

  test('exposes candidate discovery as a read-only CLI command', () => {
    const root = mkdtempSync(join(tmpdir(), 'harness-memory-candidates-'));
    onTestFinished(() => rmSync(root, { recursive: true, force: true }));
    const payload = join(root, 'event.json');
    mkdirSync(root, { recursive: true });
    writeFileSync(
      payload,
      JSON.stringify({
        source: 'chat',
        text: '以后所有 review 都必须提供证据和最小修复方向。',
      }),
    );
    const io = capturedIo();

    expect(
      runCli(['memory', 'discover-candidates', '--payload-file', payload, '--json'], {
        runtime: harnessRuntime(root),
        io,
      }),
    ).toBe(0);
    expect(JSON.parse(io.logs[0]).candidates[0].key).toBe('engineering.review-standard');
  });
});

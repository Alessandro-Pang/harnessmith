import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { onTestFinished, test } from 'vitest';
import { checkEvalRunSchemaAdapterEnum } from '../../scripts/eval-run-schema.js';
import {
  type AgentName,
  adapterAliasMap,
  adapterRegistry,
  evalAdapterEnum,
  getAdapterDefinition,
  supportedAgentNames,
} from '../adapter-registry.js';
import { adapterCapabilities, createAdapter } from '../adapters.js';
import { normalizeAgents, supportedAgents } from '../agents.js';
import { instructionFormats, instructionRenderer } from '../instruction-formats.js';

const repositoryRoot = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('adapter registry is the single host inventory for CLI selection and aliases', () => {
  assert.deepEqual(
    supportedAgentNames,
    adapterRegistry.map(({ name }) => name),
  );
  assert.deepEqual(
    supportedAgents.map(({ value, label, hint }) => ({ value, label, hint })),
    adapterRegistry.map(({ name, label, hint }) => ({ value: name, label, hint })),
  );
  assert.deepEqual(normalizeAgents(['all']), [...supportedAgentNames]);
  assert.deepEqual(normalizeAgents(['claude-code']), ['claude']);
  assert.deepEqual(normalizeAgents(['kimi-code']), ['kimi']);
  assert.deepEqual(normalizeAgents(['dsh', 'deepseek-harness']), ['deepseek']);
  assert.deepEqual(normalizeAgents(['1', '2', '3', '4', '5', '6', '7']), [...supportedAgentNames]);
  assert.deepEqual([...adapterAliasMap().entries()].sort(), [
    ['1', 'codex'],
    ['2', 'cursor'],
    ['3', 'claude'],
    ['4', 'opencode'],
    ['5', 'kimi'],
    ['6', 'deepseek'],
    ['7', 'pi'],
    ['claude-code', 'claude'],
    ['deepseek-harness', 'deepseek'],
    ['dsh', 'deepseek'],
    ['kimi-code', 'kimi'],
    ['pi-agent', 'pi'],
  ]);
});

test('capabilities and labels always come from the registry entry', () => {
  for (const entry of adapterRegistry) {
    assert.deepEqual(adapterCapabilities(entry.name), entry.capabilities);
    assert.equal(getAdapterDefinition(entry.name).label, entry.label);
  }
});

test('eval adapter enum is derived from the same registry list', () => {
  assert.deepEqual(evalAdapterEnum(), [...supportedAgentNames]);
  const result = checkEvalRunSchemaAdapterEnum(repositoryRoot);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.deepEqual(result.expected, evalAdapterEnum());
});

test('instruction format extension points cover every registry capability format', () => {
  const formats = new Set(
    adapterRegistry.map(({ capabilities }) => capabilities.instructionFormat),
  );
  for (const format of formats) {
    assert.ok(format in instructionFormats, `missing instruction format extension: ${format}`);
    const rendered = instructionRenderer(format)('body');
    assert.match(rendered, /managed-by: harnessmith/);
    assert.match(rendered, /body/);
  }
});

test('createAdapter preserves registry metadata for every registered host', () => {
  const root = mkdtempSync(join(tmpdir(), 'harnessmith-registry-create-'));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'project'), { recursive: true });
  const env = {
    HOME: root,
    CODEX_HOME: join(root, 'codex'),
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    OPENCODE_CONFIG_DIR: join(root, 'opencode'),
    KIMI_CODE_HOME: join(root, 'kimi'),
    DSH_HOME: join(root, 'dsh'),
    PI_CODING_AGENT_DIR: join(root, 'pi'),
  };

  for (const entry of adapterRegistry) {
    const adapter = createAdapter(entry.name, { env, project: join(root, 'project') });
    assert.equal(adapter.name, entry.name);
    assert.equal(adapter.label, entry.label);
    assert.deepEqual(adapter.capabilities, entry.capabilities);
    assert.ok(adapter.instructions.length > 0);
  }
});

test('AgentName union stays aligned with registry order used by install records', () => {
  const names: AgentName[] = ['codex', 'cursor', 'claude', 'opencode', 'kimi', 'deepseek', 'pi'];
  assert.deepEqual(names, [...supportedAgentNames]);
});

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { onTestFinished, test } from 'vitest';
import { adapterRegistry } from '../adapters/adapter-registry.js';
import { createAdapter } from '../adapters/adapters.js';
import {
  renderMarkdownInstructions,
  renderMdcInstructions,
} from '../adapters/instruction-formats.js';

const body = 'ENTRY BODY for byte-lock';

function fixture(prefix: string) {
  const root = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(root, { recursive: true, force: true }));
  const project = join(root, 'project');
  mkdirSync(project, { recursive: true });
  const env = {
    HOME: root,
    CODEX_HOME: join(root, 'codex'),
    CLAUDE_CONFIG_DIR: join(root, 'claude'),
    OPENCODE_CONFIG_DIR: join(root, 'opencode'),
    KIMI_CODE_HOME: join(root, 'kimi'),
  };
  return { root, project, env };
}

test('every adapter instruction renders byte-identical managed output', () => {
  const { project, env } = fixture('harnessmith-instruction-bytes-');
  for (const entry of adapterRegistry) {
    const adapter = createAdapter(entry.name, { env, project });
    assert.ok(adapter.instructions.length > 0, `${entry.name} has instructions`);
    for (const instruction of adapter.instructions) {
      const rendered = instruction.render(body);
      const expected = instruction.path.endsWith('.mdc')
        ? renderMdcInstructions(body)
        : renderMarkdownInstructions(body);
      assert.equal(rendered, expected, `${entry.name} ${instruction.path}`);
      assert.ok(rendered.includes('managed-by: harnessmith'));
      assert.ok(rendered.includes(body));
    }
  }
});

test('cursor keeps a markdown entry and a distinct mdc native rule', () => {
  const { project, env } = fixture('harnessmith-cursor-bytes-');
  const adapter = createAdapter('cursor', { env, project });
  const entryInstruction = adapter.instructions.find(({ path }) => path.endsWith('AGENTS.md'));
  const mdcInstruction = adapter.instructions.find(({ path }) => path.endsWith('.mdc'));
  assert.ok(entryInstruction, 'cursor has a markdown AGENTS.md entry');
  assert.ok(mdcInstruction, 'cursor has an mdc native rule');
  assert.equal(entryInstruction.render(body), renderMarkdownInstructions(body));
  assert.equal(mdcInstruction.render(body), renderMdcInstructions(body));
  assert.match(mdcInstruction.render(body), /^---\ndescription: Personal coding agent harness/m);
  assert.match(mdcInstruction.render(body), /alwaysApply: true/);
});

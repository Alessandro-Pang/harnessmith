import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('entry guidance routes multilingual response policy without persisting one turn', () => {
  const agents = readFileSync(join(root, 'template', 'AGENTS.md'), 'utf8');
  const operatingModel = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'core', 'operating-model.md'),
    'utf8',
  );
  const profile = readFileSync(
    join(root, 'template', 'agent-harness', 'docs', 'standards', 'user-profile-memory.md'),
    'utf8',
  );

  assert.match(agents, /回复语言.*当前明确要求.*持久证据.*当前请求检测/s);
  assert.match(operatingModel, /当前请求中的明确要求.*持久证据.*自动检测/s);
  assert.match(operatingModel, /identifier、命令、路径和错误原文保持原样/);
  assert.match(profile, /单次翻译、改写.*不是.*长期.*证据/s);
  assert.doesNotMatch(agents, /使用简体中文/);
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

test('public positioning uses one control-plane scope and explicit capability states', () => {
  const readme = readFileSync(join(root, 'README.md'), 'utf8');
  const english = readFileSync(join(root, 'README.en.md'), 'utf8');
  const llms = readFileSync(join(root, 'llms.txt'), 'utf8');
  const architecture = readFileSync(join(root, 'docs', 'architecture.md'), 'utf8');
  const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as {
    description?: string;
  };

  assert.match(readme, /跨 Host 的 Personal Harness 分发与工作状态控制层/);
  assert.match(english, /cross-host Personal Harness distribution and work-state control plane/);
  assert.match(llms, /cross-host Personal Harness distribution and work-state control plane/);
  assert.match(architecture, /跨 Host 的 Personal Harness 分发与工作状态控制层/);
  assert.match(
    packageJson.description ?? '',
    /cross-host personal harness and durable work state/i,
  );

  for (const [path, content] of [
    ['README.md', readme],
    ['README.en.md', english],
    ['docs/architecture.md', architecture],
  ]) {
    assert.match(content, /Implemented|已实现/, `${path} must label implemented capabilities`);
    assert.match(
      content,
      /Delegated to the Host|由宿主负责/,
      `${path} must label host-owned capabilities`,
    );
    assert.match(content, /Unsupported|不支持/, `${path} must label unsupported capabilities`);
  }
  assert.match(readme, /docs\/capability-evidence\.yaml/);
  assert.match(english, /docs\/capability-evidence\.yaml/);
  assert.match(architecture, /capability-evidence\.yaml/);
  for (const [path, content] of [
    ['README.md', readme],
    ['README.en.md', english],
    ['docs/architecture.md', architecture],
  ]) {
    assert.match(
      content,
      /audit record/,
      `${path} must expose the host-neutral audit ingestion point`,
    );
    assert.match(content, /raw prompt|原始 prompt/i, `${path} must state the raw-content boundary`);
  }
});

test('architecture documents the mechanically checked ownership and write boundaries', () => {
  const architecture = readFileSync(join(root, 'docs', 'architecture.md'), 'utf8');

  assert.match(architecture, /lib.*不得依赖.*commands/s);
  assert.match(architecture, /typed work-state command.*不得直接.*文件系统写入/s);
  assert.match(architecture, /Task.*complete.*assertTaskCanComplete.*acceptance gate/s);
  assert.match(architecture, /Host identity.*外层 Adapter/s);
  assert.match(architecture, /capability claim.*唯一.*executable verification/s);
});

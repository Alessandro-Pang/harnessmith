import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';
import { elementAt } from '../../../../packages/harness/src/__tests__/helpers/harness.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

test('documentation site has reproducible local build, search, links, and Pages deployment', () => {
  const manifest = JSON.parse(read('package.json')) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  // Build tooling must be present, but patch versions are not a site contract.
  for (const dependency of ['vitepress', 'mermaid', 'vitepress-plugin-mermaid']) {
    assert.ok(manifest.devDependencies?.[dependency], `missing site dependency: ${dependency}`);
  }
  assert.equal(manifest.scripts?.['docs:dev'], 'vitepress dev apps/docs/site');
  assert.equal(manifest.scripts?.['docs:build'], 'vitepress build apps/docs/site');
  assert.equal(manifest.scripts?.['docs:preview'], 'vitepress preview apps/docs/site');
  // The check gate routes through the same production build instead of a second command line.
  assert.equal(manifest.scripts?.['docs:check'], 'pnpm run docs:build');

  const config = read('apps/docs/site/.vitepress/config.ts');
  assert.match(config, /base:\s*['"]\/harnessmith\/['"]/);
  assert.match(config, /href:\s*['"]\/harnessmith\/brand\/harnessmith-logo\.svg['"]/);
  assert.match(
    config,
    /href:\s*['"]\/harnessmith\/brand\/harnessmith-logo-dark\.svg['"],\s*media:\s*['"]\(prefers-color-scheme: dark\)['"]/,
  );
  assert.match(config, /provider:\s*['"]local['"]/);
  assert.match(config, /lang:\s*['"]en['"]/);
  assert.doesNotMatch(config, /ignoreDeadLinks:\s*true/);
  assert.match(config, /withMermaid/);

  const deadCodeConfig = read('config/knip.json');
  assert.match(deadCodeConfig, /site\/\.vitepress\/config\.ts/);
  assert.match(deadCodeConfig, /"mermaid"/);

  assert.match(read('apps/docs/site/.vitepress/theme/custom.css'), /:focus-visible/);

  const workflow = read('.github/workflows/docs.yml');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /pnpm run docs:build/);
  assert.match(workflow, /actions\/deploy-pages@[0-9a-f]{40} # v4/);
});

test('articles rely on theme prev-next navigation instead of handwritten reading footers', () => {
  const markdownFiles = readdirSync(join(root, 'apps', 'docs', 'site'), { recursive: true })
    .map(String)
    .filter((path) => path.endsWith('.md'));

  for (const path of markdownFiles) {
    const content = read(join('apps', 'docs', 'site', path));
    assert.doesNotMatch(
      content,
      /^##\s+(?:接下来读什么|继续阅读|下一步)\s*$/m,
      `${path} must not duplicate theme prev-next navigation`,
    );
    assert.doesNotMatch(
      content,
      /(?:下一步可以阅读|继续阅读\[)/,
      `${path} must not end with handwritten reading links`,
    );
  }
});

test('architecture and lifecycle diagrams render through Mermaid', () => {
  for (const path of [
    'apps/docs/site/zh/concepts/architecture.md',
    'apps/docs/site/zh/concepts/how-it-works.md',
    'apps/docs/site/zh/concepts/memory-and-tasks.md',
  ]) {
    const content = read(path);
    assert.match(content, /```mermaid\n/);
    assert.match(content, /flowchart\s+(?:BT|TD|LR)/);
    assert.doesNotMatch(content, /```text\n/);
    assert.doesNotMatch(content, /[┌┐└┘├┤┬┴┼]/);
  }
});

test('project logo assets exist, are wired into both themes, and stay accessible', () => {
  const config = read('apps/docs/site/.vitepress/config.ts');
  const home = read('apps/docs/site/zh/index.md');

  for (const asset of [
    'apps/docs/site/public/brand/harnessmith-logo.svg',
    'apps/docs/site/public/brand/harnessmith-logo-dark.svg',
  ]) {
    assert.equal(existsSync(join(root, asset)), true, `${asset} must exist`);
    // An accessible name is required; the drawing technique itself is not a contract.
    assert.match(read(asset), /<title(?:\s+id="title")?>Harnessmith<\/title>/);
  }
  assert.match(
    config,
    /logo:\s*{\s*light:\s*['"]\/brand\/harnessmith-logo\.svg['"],\s*dark:\s*['"]\/brand\/harnessmith-logo-dark\.svg['"],?\s*}/,
  );
  assert.match(home, /image:\s*\n\s+src:\s*\/brand\/harnessmith-logo\.svg/);
  assert.match(home, /alt:\s*Harnessmith logo/);
  for (const readme of ['README.md', 'README.en.md']) {
    assert.match(
      read(readme),
      /<img src="\.\/apps\/docs\/site\/public\/brand\/harnessmith-logo\.svg"/,
      `${readme} must show the project logo`,
    );
  }
});

test('language switching is the only English entry in the Chinese site chrome', () => {
  const config = read('apps/docs/site/.vitepress/config.ts');
  const home = read('apps/docs/site/zh/index.md');
  const styles = read('apps/docs/site/.vitepress/theme/custom.css');
  const navPattern = /nav:\s*\[([\s\S]*?)\],\n\s*sidebar:/g;
  const localeNavs = [...config.matchAll(navPattern)].map((match) => elementAt(match, 1));
  assert.ok(localeNavs.length >= 2, 'every locale nav must be paired with its sidebar');

  for (const nav of localeNavs) {
    assert.doesNotMatch(nav, /text:\s*['"]English['"]/);
  }
  assert.doesNotMatch(home, /English reader|English overview|home-english/);
  assert.doesNotMatch(styles, /\.home-english\s*{/);

  // Language switching must stay on the corresponding page; `i18nRouting: false`
  // degrades the switcher to locale home pages (see theme-default/composables/langs.js).
  assert.doesNotMatch(config, /i18nRouting:\s*false/);
  assert.match(config, /logoLink:\s*['"]\/harnessmith\/['"]/);
  assert.match(config, /logoLink:\s*['"]\/harnessmith\/en\/['"]/);
  assert.match(
    config,
    /en:\s*{\s*label:\s*['"]English['"],\s*lang:\s*['"]en['"],\s*link:\s*['"]\/en\/['"]/,
  );
});

test('history separates project origin from the blind review and keeps canonical external references', () => {
  const history = read('apps/docs/site/zh/concepts/history-and-influences.md');
  const references = read('apps/docs/site/zh/reference/references.md');

  assert.doesNotMatch(history, /starport/i);
  assert.doesNotMatch(history, /研发前|Architecture Review|架构评审/);
  assert.doesNotMatch(references, /Personal Agent Harness CLI Architecture Review|研发前架构评审/);
  assert.match(references, /https:\/\/picrew\.github\.io\/LLM-Harness\//);
  assert.match(references, /en\.wikipedia\.org\/wiki\/Test_harness/);
  assert.match(references, /github\.com\/EleutherAI\/lm-evaluation-harness/);
});

test('memory and task overview links to the current canonical runtime protocols', () => {
  const overview = read('apps/docs/site/zh/concepts/memory-and-tasks.md');

  assert.match(
    overview,
    /template\/skills\/agent-harness\/docs\/standards\/project-agent-docs\.md/,
  );
  assert.match(overview, /template\/skills\/agent-harness\/docs\/core\/long-running-tasks\.md/);
  assert.doesNotMatch(overview, /core\/memory-architecture\.md|topics\/task-lifecycle\.md/);
});

test('release documentation distinguishes post-publish registry clean-room evidence', () => {
  const evaluation = read('apps/docs/site/zh/concepts/evidence-and-evaluation.md');
  const capabilities = read('apps/docs/site/capability-evidence.yaml');
  const contributing = read('CONTRIBUTING.md');

  assert.match(evaluation, /release:verify-registry/);
  assert.match(evaluation, /registry metadata.*integrity.*隔离安装/s);
  assert.match(evaluation, /传播延迟.*metadata.*integrity.*运行失败/s);
  // The claim id keeps the capability public; preflight mechanically validates that every
  // listed implementation/verification evidence path exists and is executable.
  assert.match(capabilities, /id: post-publish-registry-verification/);
  assert.match(contributing, /registry clean-room/i);
});

test('cross-repository relationships remain a first-class public capability', () => {
  const readme = read('README.md');
  const english = read('README.en.md');
  const architecture = read('apps/docs/site/zh/concepts/architecture.md');
  const evidence = read('apps/docs/site/capability-evidence.yaml');

  assert.match(readme, /repository-map check/);
  assert.match(readme, /跨仓库关系|项目关系/);
  assert.match(english, /repository-map check/);
  assert.match(english, /reference\/runtime-cli#repository-map/);
  assert.match(architecture, /Repository Map/);
  assert.match(evidence, /id: cross-repository-map/);
});

test('architecture and capture-eligibility capabilities stay publicly evidenced', () => {
  const architecture = read('apps/docs/site/zh/concepts/architecture.md');
  const evidence = read('apps/docs/site/capability-evidence.yaml');

  assert.match(architecture, /capture eligibility/i);
  assert.match(evidence, /id: architecture-invariant-preflight/);
  assert.match(evidence, /id: memory-capture-eligibility/);
});

test('current distribution docs describe the package-bundled Runtime and skills-managed skill, not a shared hub', () => {
  const manifest = JSON.parse(read('package.json')) as {
    dependencies?: Record<string, string>;
  };
  const skillsVersion = manifest.dependencies?.skills;
  assert.ok(skillsVersion, 'package.json must pin the skills dependency');
  const skillsPattern = new RegExp(`skills@${skillsVersion.replace(/\./g, '\\.')}`);

  const distributionDocs = [
    'apps/docs/site/zh/concepts/architecture.md',
    'apps/docs/site/en/concepts/architecture.md',
    'apps/docs/site/zh/guide/hosts.md',
    'apps/docs/site/en/guide/hosts.md',
    'apps/docs/site/zh/reference/runtime-cli.md',
    'apps/docs/site/en/reference/runtime-cli.md',
  ];
  for (const path of distributionDocs) {
    const content = read(path);
    // The Runtime runs from the npm package root; no skill script entry or hub placeholder remains.
    assert.match(content, /dist\/harness\.mjs/, path);
    assert.doesNotMatch(content, /scripts\/harness\.mjs/, path);
    assert.doesNotMatch(content, /<hub>/, path);
    // User data defaults to ~/.harnessmith.
    assert.match(content, /~\/\.harnessmith/, path);
  }
  // Architecture and hosts name the pinned skills dependency that owns skill install/uninstall.
  for (const path of [
    'apps/docs/site/zh/concepts/architecture.md',
    'apps/docs/site/en/concepts/architecture.md',
    'apps/docs/site/zh/guide/hosts.md',
    'apps/docs/site/en/guide/hosts.md',
  ]) {
    const content = read(path);
    assert.match(content, skillsPattern, path);
    assert.match(content, /~\/\.agents\/skills\/agent-harness/, path);
  }
  // Existing users must see the incompatibility and the absence of automatic data deletion.
  for (const path of [
    'apps/docs/site/zh/reference/migrations.md',
    'apps/docs/site/en/reference/migrations.md',
  ]) {
    const content = read(path);
    assert.match(content, /schemaVersion:\s*3/i, path);
    assert.match(content, /~\/\.agents\/harnessmith/, path);
    assert.doesNotMatch(content, /Historical layout 3\.0|历史布局 3\.0/, path);
  }
});

test('advanced README material remains available in the documentation site', () => {
  const runtime = read('apps/docs/site/zh/reference/runtime-cli.md');
  const config = read('apps/docs/site/.vitepress/config.ts');
  const strategy = read('apps/docs/site/zh/maintain/content-strategy.md');

  for (const topic of [
    'route',
    'scanLimits',
    'capture-input',
    'capture-experience',
    'profile-autopilot',
    'repository-map',
    'task verify',
    'audit maintain',
    '--consume-payload-file',
    'HARNESS_MEMORY_HOME',
  ]) {
    assert.match(runtime, new RegExp(topic.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(config, /运行时 CLI/);
  assert.match(config, /\/reference\/runtime-cli/);
  assert.match(strategy, /README 精简门禁/);
  assert.match(strategy, /迁移清单/);
  assert.match(strategy, /重复、过时或纯实现细节/);
});

test('maintenance decisions live in subject documentation instead of a standalone ADR section', () => {
  const config = read('apps/docs/site/.vitepress/config.ts');
  const strategy = read('apps/docs/site/zh/maintain/content-strategy.md');

  assert.doesNotMatch(config, /text:\s*['"]ADR['"]|\/decisions\//);
  assert.equal(existsSync(join(root, 'apps/docs/site/decisions/index.md')), false);
  assert.equal(
    existsSync(join(root, 'apps/docs/site/decisions/0001-documentation-site.md')),
    false,
  );
  assert.match(strategy, /构建阶段生成.*本地搜索索引/s);
  assert.match(strategy, /不提供向量语义召回/);
});

test('markdown emphasis avoids known clipping patterns', () => {
  const architecture = read('apps/docs/site/zh/concepts/architecture.md');

  assert.doesNotMatch(architecture, /）\*\*[^\s]/u);
});

test('documentation site covers user, contributor, architecture, boundary, and history routes', () => {
  const pages = [
    'apps/docs/site/zh/index.md',
    'apps/docs/site/zh/guide/why-harnessmith.md',
    'apps/docs/site/zh/guide/getting-started.md',
    'apps/docs/site/zh/guide/hosts.md',
    'apps/docs/site/zh/guide/lifecycle.md',
    'apps/docs/site/zh/reference/cli.md',
    'apps/docs/site/zh/reference/runtime-cli.md',
    'apps/docs/site/zh/reference/temporary-resources.md',
    'apps/docs/site/zh/concepts/architecture.md',
    'apps/docs/site/zh/concepts/how-it-works.md',
    'apps/docs/site/zh/concepts/harness-engineering.md',
    'apps/docs/site/zh/concepts/design-principles.md',
    'apps/docs/site/zh/concepts/boundaries.md',
    'apps/docs/site/zh/concepts/memory-and-tasks.md',
    'apps/docs/site/zh/concepts/evidence-and-evaluation.md',
    'apps/docs/site/zh/concepts/history-and-influences.md',
    'apps/docs/site/zh/maintain/content-strategy.md',
    'apps/docs/site/zh/maintain/contributing.md',
    'apps/docs/site/zh/maintain/contributing-docs.md',
    'apps/docs/site/zh/reference/references.md',
    'apps/docs/site/zh/reference/migrations.md',
    'apps/docs/site/en/index.md',
    'apps/docs/site/en/guide/getting-started.md',
    'apps/docs/site/en/guide/why-harnessmith.md',
    'apps/docs/site/en/guide/hosts.md',
    'apps/docs/site/en/guide/lifecycle.md',
    'apps/docs/site/en/guide/first-value-loop.md',
    'apps/docs/site/en/concepts/harness-engineering.md',
    'apps/docs/site/en/concepts/how-it-works.md',
    'apps/docs/site/en/concepts/architecture.md',
    'apps/docs/site/en/concepts/design-principles.md',
    'apps/docs/site/en/concepts/boundaries.md',
    'apps/docs/site/en/concepts/memory-and-tasks.md',
    'apps/docs/site/en/concepts/evidence-and-evaluation.md',
    'apps/docs/site/en/concepts/history-and-influences.md',
    'apps/docs/site/en/reference/cli.md',
    'apps/docs/site/en/reference/runtime-cli.md',
    'apps/docs/site/en/reference/temporary-resources.md',
    'apps/docs/site/en/reference/migrations.md',
    'apps/docs/site/en/reference/references.md',
    'apps/docs/site/en/maintain/contributing.md',
    'apps/docs/site/en/maintain/contributing-docs.md',
    'apps/docs/site/en/maintain/content-strategy.md',
  ];

  for (const page of pages) {
    assert.equal(existsSync(join(root, page)), true, `${page} must exist`);
    const content = read(page);
    assert.match(content, /^---\n[\s\S]*?owner:\s*maintainers\n[\s\S]*?---\n/);
    if (page === 'apps/docs/site/zh/index.md' || page === 'apps/docs/site/en/index.md') {
      assert.match(content, /^layout:\s*home$/m);
      assert.match(content, /^hero:\n[\s\S]*?^\s+name:\s*.+$/m);
    } else {
      assert.match(content, /^#\s+.+/m);
    }
  }
});

test('core documentation keeps authorization, evaluation, and deletion safety boundaries', () => {
  const config = read('apps/docs/site/.vitepress/config.ts');

  const how = read('apps/docs/site/zh/concepts/how-it-works.md');
  assert.match(how, /不传递授权/);

  const evaluation = read('apps/docs/site/zh/concepts/evidence-and-evaluation.md');
  assert.match(evaluation, /确定性仓库验证/);
  assert.match(evaluation, /真实宿主评测/);
  assert.match(evaluation, /只有在维护者显式调用.*pnpm run eval:codex.*才会启动/);
  assert.match(evaluation, /不会在 import 时隐式启动/);
  assert.match(evaluation, /仍需提供凭据/);
  assert.match(evaluation, /不能证明/);

  const temporaryResources = read('apps/docs/site/zh/reference/temporary-resources.md');
  assert.match(temporaryResources, /^# 临时资源生命周期$/m);
  assert.match(temporaryResources, /不能单独构成删除依据/);
  assert.match(config, /临时资源.*\/reference\/temporary-resources/s);

  const versions = read('apps/docs/site/zh/reference/migrations.md');
  assert.doesNotMatch(versions, /当前公开 npm 版本线|`0\.8\.x`/);
  assert.match(versions, /不在长期文档里复制当前版本/);
});

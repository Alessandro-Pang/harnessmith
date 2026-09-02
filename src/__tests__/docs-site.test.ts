import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'vitest';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function read(relativePath: string): string {
  return readFileSync(join(root, relativePath), 'utf8');
}

test('documentation site has reproducible local build, search, links, and Pages deployment', () => {
  const manifest = JSON.parse(read('package.json')) as {
    scripts?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  assert.equal(manifest.devDependencies?.vitepress, '1.6.4');
  assert.equal(manifest.devDependencies?.mermaid, '11.17.2');
  assert.equal(manifest.devDependencies?.['vitepress-plugin-mermaid'], '2.0.17');
  assert.equal(manifest.scripts?.['docs:dev'], 'vitepress dev docs');
  assert.equal(manifest.scripts?.['docs:build'], 'vitepress build docs');
  assert.equal(manifest.scripts?.['docs:preview'], 'vitepress preview docs');
  assert.equal(manifest.scripts?.['docs:check'], 'vitepress build docs');

  const config = read('docs/.vitepress/config.ts');
  assert.match(config, /base:\s*['"]\/harnessmith\/['"]/);
  assert.match(
    config,
    /rel:\s*['"]icon['"],\s*type:\s*['"]image\/svg\+xml['"],\s*href:\s*['"]\/harnessmith\/brand\/harnessmith-logo\.svg['"]/,
  );
  assert.match(
    config,
    /href:\s*['"]\/harnessmith\/brand\/harnessmith-logo-dark\.svg['"],\s*media:\s*['"]\(prefers-color-scheme: dark\)['"]/,
  );
  assert.match(config, /provider:\s*['"]local['"]/);
  assert.match(config, /lang:\s*['"]en['"]/);
  assert.doesNotMatch(config, /ignoreDeadLinks:\s*true/);
  assert.match(config, /withMermaid/);
  assert.match(config, /mermaid:\s*{/);
  assert.match(config, /light:\s*['"]github-dark-high-contrast['"]/);
  assert.match(config, /dark:\s*['"]github-dark-high-contrast['"]/);

  const deadCodeConfig = read('knip.json');
  assert.match(deadCodeConfig, /docs\/\.vitepress\/config\.ts/);
  assert.match(deadCodeConfig, /"mermaid"/);

  assert.match(read('docs/.vitepress/theme/custom.css'), /:focus-visible/);

  const workflow = read('.github/workflows/docs.yml');
  assert.match(workflow, /pull_request:/);
  assert.match(workflow, /branches:\s*\[main\]/);
  assert.match(workflow, /pnpm run docs:build/);
  assert.match(workflow, /actions\/deploy-pages@v4/);
});

test('articles rely on theme prev-next navigation instead of handwritten reading footers', () => {
  const markdownFiles = readdirSync(join(root, 'docs'), { recursive: true })
    .map(String)
    .filter((path) => path.endsWith('.md'));

  for (const path of markdownFiles) {
    const content = read(join('docs', path));
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
    'docs/architecture.md',
    'docs/concepts/how-it-works.md',
    'docs/concepts/memory-and-tasks.md',
  ]) {
    const content = read(path);
    assert.match(content, /```mermaid\n/);
    assert.match(content, /flowchart\s+(?:BT|TD|LR)/);
    assert.doesNotMatch(content, /```text\n/);
    assert.doesNotMatch(content, /[┌┐└┘├┤┬┴┼]/);
  }
});

test('home and theme provide a distinctive responsive visual system', () => {
  const home = read('docs/index.md');
  const styles = read('docs/.vitepress/theme/custom.css');

  assert.doesNotMatch(home, /^features:/m);
  assert.match(home, /class="home-signal"/);
  assert.match(home, /class="home-bento"/);
  assert.match(home, /class="home-path"/);

  assert.match(styles, /\.VPHomeHero/);
  assert.match(styles, /\.home-bento/);
  assert.match(styles, /background-image:/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(styles, /html\.dark/);
  assert.match(styles, /\.home-card-boundary a\s*{[^}]*position:\s*static/s);
  assert.match(styles, /\.home-card-boundary a\s*{[^}]*margin-top:\s*auto/s);
  assert.match(styles, /\.mermaid \.nodeLabel\s*{[^}]*line-height:\s*1\.3/s);
});

test('project logo is available in both themes and shown on the home page and READMEs', () => {
  const config = read('docs/.vitepress/config.ts');
  const home = read('docs/index.md');
  const styles = read('docs/.vitepress/theme/custom.css');
  const chinese = read('README.md');
  const english = read('README.en.md');

  assert.equal(existsSync(join(root, 'docs/public/brand/harnessmith-logo.svg')), true);
  assert.equal(existsSync(join(root, 'docs/public/brand/harnessmith-logo-dark.svg')), true);
  assert.match(
    config,
    /logo:\s*{\s*light:\s*['"]\/brand\/harnessmith-logo\.svg['"],\s*dark:\s*['"]\/brand\/harnessmith-logo-dark\.svg['"],?\s*}/,
  );
  assert.match(home, /image:\s*\n\s+src:\s*\/brand\/harnessmith-logo\.svg/);
  assert.match(home, /alt:\s*Harnessmith logo/);
  assert.match(styles, /\.VPHomeHero \.image-src\s*{[^}]*transform:\s*translate\(-50%,\s*0\)/s);
  assert.match(styles, /html\.dark \.VPHomeHero \.image-src\s*{[^}]*harnessmith-logo-dark\.svg/s);
  assert.match(
    styles,
    /@media \(max-width:\s*640px\)[\s\S]*?\.VPHomeHero \.image\s*{[^}]*display:\s*none/s,
  );
  assert.match(
    chinese,
    /^# Harnessmith\n\n<p align="center">\n\s*<img src="\.\/docs\/public\/brand\/harnessmith-logo\.svg"/,
  );
  assert.match(
    english,
    /^# Harnessmith\n\n<p align="center">\n\s*<img src="\.\/docs\/public\/brand\/harnessmith-logo\.svg"/,
  );

  for (const asset of [
    'docs/public/brand/harnessmith-logo.svg',
    'docs/public/brand/harnessmith-logo-dark.svg',
  ]) {
    const logo = read(asset);
    assert.match(logo, /<title(?:\s+id="title")?>Harnessmith<\/title>/);
    assert.match(logo, /<linearGradient/);
    assert.doesNotMatch(logo, /<image|filter=|data:image/);
  }
});

test('language switching is the only English entry in the Chinese site chrome', () => {
  const config = read('docs/.vitepress/config.ts');
  const home = read('docs/index.md');
  const styles = read('docs/.vitepress/theme/custom.css');
  const primaryNav = config.match(/nav:\s*\[([\s\S]*?)\],\n\s*sidebar:/)?.[1] ?? '';

  assert.doesNotMatch(primaryNav, /text:\s*['"]English['"]/);
  assert.doesNotMatch(home, /English reader|English overview|home-english/);
  assert.doesNotMatch(styles, /\.home-english\s*{/);

  assert.match(config, /i18nRouting:\s*false/);
  assert.match(config, /logoLink:\s*['"]\/harnessmith\/['"]/);
  assert.match(
    config,
    /en:\s*{\s*label:\s*['"]English['"],\s*lang:\s*['"]en['"],\s*link:\s*['"]\/en\/['"]\s*}/,
  );
  assert.match(read('docs/en/index.md'), /English getting-started guide/);
  assert.match(read('docs/en/getting-started.md'), /^#\s+Getting started/m);
});

test('history reflects the project origin without presenting the blind review as project history', () => {
  const history = read('docs/project/history-and-influences.md');
  const references = read('docs/references.md');

  assert.match(history, /^## 第一阶段：AGENTS\.md 与 \.agent-docs$/m);
  assert.match(history, /工作区地图/);
  assert.match(history, /局部规则/);
  assert.match(history, /计划、分析、输出、原型和证据/);
  assert.match(history, /背景、目标、非目标、范围、风险、阶段和验收/);
  assert.match(history, /入口负责导航，工作文档负责承载上下文/);
  assert.match(history, /没有统一索引/);
  assert.match(history, /^## 第二阶段：让文档可以被路由、检索和治理$/m);
  assert.match(history, /历史文档记录了决策如何形成.*不能.*简单删除/s);
  assert.match(history, /顺序读取全部文档.*挤占模型上下文.*幻觉/s);
  assert.match(history, /保留历史.*只把当前任务真正需要的内容送进上下文/s);
  assert.match(history, /元信息.*正文段落.*标题路径.*行号/s);
  assert.match(history, /历史仍然完整保留.*不会默认进入每一次对话/s);
  assert.match(history, /规则、事实与记忆/);
  assert.match(history, /input.*episode.*working.*distilled.*evidence/s);
  assert.match(history, /source-refs/);
  assert.match(history, /source-of-truth:\s*false/);
  assert.match(history, /完成或被替代.*归档/s);
  assert.match(history, /单个项目.*自定义.*搜索脚本/s);
  assert.match(history, /搜索 CLI/);
  assert.match(history, /Harnessmith 不是先有一套 Harness Engineering 理论.*照着它设计出来的/s);
  assert.match(history, /起初只是为了.*多个项目.*AGENTS\.md.*可复用/s);
  assert.match(history, /真正开始做通用化后.*宿主.*权限.*Memory.*验证/s);
  assert.match(history, /解决这些问题的过程中.*才发现.*Harness Engineering/s);
  assert.match(history, /^## Harnesssmith 最初只想把第二阶段通用化$/m);
  assert.match(history, /最初并不是为了实现一套行业定义的 Harness/);
  assert.match(history, /^## 通用化为什么把问题推向 Harness$/m);
  assert.match(history, /宿主差异.*授权边界.*Memory.*生命周期.*验证/s);
  assert.match(history, /^## 后来才重新调研 Harness Engineering$/m);
  assert.match(history, /先遇到工程问题，再重新调研领域/);
  assert.match(history, /早期项目专用工具/);
  assert.match(history, /没有一比一保留/);
  assert.match(history, /route.*search.*memory list.*memory check.*memory maintain/s);
  assert.match(history, /正式.*docs.*source.*日期.*不属于当前\s+契约/s);
  assert.doesNotMatch(history, /starport/i);
  assert.doesNotMatch(history, /研发前|Architecture Review|架构评审/);
  assert.doesNotMatch(references, /Personal Agent Harness CLI Architecture Review|研发前架构评审/);
  assert.match(references, /https:\/\/picrew\.github\.io\/LLM-Harness\//);
  assert.match(references, /en\.wikipedia\.org\/wiki\/Test_harness/);
  assert.match(references, /github\.com\/EleutherAI\/lm-evaluation-harness/);
});

test('memory and task overview links to the current canonical runtime protocols', () => {
  const overview = read('docs/concepts/memory-and-tasks.md');

  assert.match(overview, /template\/agent-harness\/docs\/standards\/project-agent-docs\.md/);
  assert.match(overview, /template\/agent-harness\/docs\/core\/long-running-tasks\.md/);
  assert.doesNotMatch(overview, /core\/memory-architecture\.md|topics\/task-lifecycle\.md/);
});

test('release documentation distinguishes post-publish registry clean-room evidence', () => {
  const evaluation = read('docs/concepts/evidence-and-evaluation.md');
  const capabilities = read('docs/capability-evidence.yaml');
  const contributing = read('CONTRIBUTING.md');

  assert.match(evaluation, /release:verify-registry/);
  assert.match(evaluation, /registry metadata.*integrity.*隔离安装/s);
  assert.match(evaluation, /传播延迟.*metadata.*integrity.*运行失败/s);
  assert.match(capabilities, /id: post-publish-registry-verification/);
  assert.match(capabilities, /scripts\/release\/registry-verification\.ts/);
  assert.match(capabilities, /evals\/__tests__\/registry-verification\.test\.ts/);
  assert.match(contributing, /registry clean-room/i);
});

test('cross-repository relationships remain a first-class public capability', () => {
  const readme = read('README.md');
  const english = read('README.en.md');
  const architecture = read('docs/architecture.md');
  const evidence = read('docs/capability-evidence.yaml');

  assert.match(readme, /repository-map check/);
  assert.match(readme, /跨仓库关系|项目关系/);
  assert.match(english, /repository-map check/);
  assert.match(english, /reference\/runtime-cli#repository-map/);
  assert.match(architecture, /Repository Map/);
  assert.match(evidence, /id: cross-repository-map/);
  assert.match(
    evidence,
    /template\/agent-harness\/src\/commands\/repository-map\/repository-map\.ts/,
  );
  assert.match(evidence, /template\/agent-harness\/src\/__tests__\/repository-map\.test\.ts/);
});

test('architecture invariants have implementation and executable verification evidence', () => {
  const evidence = read('docs/capability-evidence.yaml');

  assert.match(evidence, /id: architecture-invariant-preflight/);
  assert.match(evidence, /scripts\/preflight\/preflight-architecture\.ts/);
  assert.match(evidence, /scripts\/evaluation\/capability-evidence\.ts/);
  assert.match(evidence, /src\/__tests__\/preflight-architecture\.test\.ts/);
  assert.match(evidence, /src\/__tests__\/preflight-docs\.test\.ts/);
});

test('capture eligibility has public architecture and executable evidence', () => {
  const architecture = read('docs/architecture.md');
  const evidence = read('docs/capability-evidence.yaml');

  assert.match(architecture, /capture eligibility/i);
  assert.match(evidence, /id: memory-capture-eligibility/);
  assert.match(evidence, /memory-capture-eligibility\.ts/);
  assert.match(evidence, /memory-capture-eligibility\.test\.ts/);
});

test('advanced README material remains available in the documentation site', () => {
  const runtime = read('docs/reference/runtime-cli.md');
  const config = read('docs/.vitepress/config.ts');
  const strategy = read('docs/content-strategy.md');

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
  const config = read('docs/.vitepress/config.ts');
  const strategy = read('docs/content-strategy.md');

  assert.doesNotMatch(config, /text:\s*['"]ADR['"]|\/decisions\//);
  assert.equal(existsSync(join(root, 'docs/decisions/index.md')), false);
  assert.equal(existsSync(join(root, 'docs/decisions/0001-documentation-site.md')), false);
  assert.match(strategy, /构建阶段生成.*本地搜索索引/s);
  assert.match(strategy, /不提供向量语义召回/);
});

test('markdown emphasis and Mermaid labels avoid known clipping patterns', () => {
  const architecture = read('docs/architecture.md');

  assert.doesNotMatch(architecture, /）\*\*[^\s]/u);
  assert.match(architecture, /Coding Agent 宿主<br\/>模型循环 · 工具\/MCP<br\/>sandbox/);
  assert.match(architecture, /Personal Harness<br\/>短规则入口 · 文档路由<br\/>Memory/);
});

test('documentation site covers user, contributor, architecture, boundary, and history routes', () => {
  const pages = [
    'docs/index.md',
    'docs/guide/why-harnessmith.md',
    'docs/guide/getting-started.md',
    'docs/guide/hosts.md',
    'docs/guide/lifecycle.md',
    'docs/reference/cli.md',
    'docs/reference/runtime-cli.md',
    'docs/temporary-resources.md',
    'docs/architecture.md',
    'docs/concepts/how-it-works.md',
    'docs/concepts/harness-engineering.md',
    'docs/concepts/design-principles.md',
    'docs/concepts/boundaries.md',
    'docs/concepts/memory-and-tasks.md',
    'docs/concepts/evidence-and-evaluation.md',
    'docs/project/history-and-influences.md',
    'docs/content-strategy.md',
    'docs/contributing.md',
    'docs/references.md',
    'docs/versions/migrations.md',
    'docs/en/index.md',
    'docs/en/getting-started.md',
  ];

  for (const page of pages) {
    assert.equal(existsSync(join(root, page)), true, `${page} must exist`);
    const content = read(page);
    assert.match(content, /^---\n[\s\S]*?owner:\s*maintainers\n[\s\S]*?---\n/);
    if (page === 'docs/index.md') {
      assert.match(content, /^layout:\s*home$/m);
      assert.match(content, /^hero:\n[\s\S]*?^\s+name:\s*.+$/m);
    } else {
      assert.match(content, /^#\s+.+/m);
    }
  }
});

test('core documentation follows a human question path and separates current facts from influences', () => {
  const config = read('docs/.vitepress/config.ts');
  assert.match(config, /认识 Harnessmith/);
  assert.match(config, /理解设计/);
  assert.match(config, /维护与贡献/);

  const home = read('docs/index.md');
  assert.match(home, /你是否遇到过/);
  assert.match(home, /从这些实际问题中长出来/);
  assert.match(home, /不替代 Coding Agent/);
  assert.match(home, /从这里开始/);

  const why = read('docs/guide/why-harnessmith.md');
  assert.match(why, /问题不是少写一份规则/);
  assert.match(why, /并不是先按一套 Harness Engineering 理论设计出来的/);
  assert.match(why, /历史文档.*不能.*直接删除.*挤占上下文.*幻觉/s);
  assert.match(why, /安装前/);
  assert.match(why, /安装后/);

  const harnessEngineering = read('docs/concepts/harness-engineering.md');
  assert.match(harnessEngineering, /不是从 Harness Engineering 的概念或分层模型出发设计的/);
  assert.match(harnessEngineering, /实际使用.*后来.*高度重合/s);

  const how = read('docs/concepts/how-it-works.md');
  assert.match(how, /安装时/);
  assert.match(how, /Agent 工作时/);
  assert.match(how, /不传递授权/);

  const architecture = read('docs/architecture.md');
  assert.match(architecture, /先记住一个模型/);
  assert.match(architecture, /为什么分成两层/);
  assert.match(architecture, /不会启动第三方宿主.*不负责登录或认证/s);

  const evaluation = read('docs/concepts/evidence-and-evaluation.md');
  assert.match(evaluation, /确定性仓库验证/);
  assert.match(evaluation, /真实宿主评测/);
  assert.match(evaluation, /不负责启动、登录或认证第三方宿主/);
  assert.match(evaluation, /不能证明/);

  const history = read('docs/project/history-and-influences.md');
  assert.match(history, /^## 第一阶段：AGENTS\.md 与 \.agent-docs$/m);
  assert.match(history, /工作区地图/);
  assert.match(history, /计划、分析、输出、原型和证据/);
  assert.match(history, /先定位.*恢复上下文.*核对当前事实/s);
  assert.match(history, /^## 第二阶段：让文档可以被路由、检索和治理$/m);
  assert.match(history, /渐进式检索/);
  assert.match(history, /非权威记忆/);
  assert.match(history, /最初只想把第二阶段通用化/);
  assert.match(history, /重新调研 Harness Engineering/);
  assert.match(history, /尚未经过双盲评审/);
  assert.match(history, /当前事实/);

  const temporaryResources = read('docs/temporary-resources.md');
  assert.match(temporaryResources, /^# 临时资源生命周期$/m);
  assert.match(temporaryResources, /不能单独构成删除依据/);
  assert.match(config, /临时资源.*\/temporary-resources/s);

  const versions = read('docs/versions/migrations.md');
  assert.doesNotMatch(versions, /当前公开 npm 版本线|`0\.8\.x`/);
  assert.match(versions, /不在长期文档里复制当前版本/);
});

test('concise bilingual READMEs preserve onboarding and safety while routing depth to docs', () => {
  const chinese = read('README.md');
  const english = read('README.en.md');

  assert.ok(chinese.split('\n').length <= 180, 'README.md must stay concise');
  assert.ok(english.split('\n').length <= 180, 'README.en.md must stay concise');
  assert.match(chinese, /https:\/\/alexpang\.cn\/harnessmith\//);
  assert.match(english, /https:\/\/alexpang\.cn\/harnessmith\/en\//);
  assert.match(chinese, /多个项目和 Coding Agent.*历史文档.*模型上下文/s);
  assert.match(english, /several projects and coding agents.*growing history.*model context/s);

  for (const content of [chinese, english]) {
    assert.match(content, /npx harnessmith/);
    assert.match(content, /npx harnessmith status/);
    assert.match(content, /npx harnessmith restore/);
    assert.match(content, /npx harnessmith uninstall/);
    assert.match(content, /Codex/);
    assert.match(content, /Cursor/);
    assert.match(content, /Claude Code/);
    assert.match(content, /OpenCode/);
    assert.match(content, /Kimi Code/);
    assert.match(content, /docs\/capability-evidence\.yaml/);
  }

  assert.doesNotMatch(chinese, /^### 分层记忆$/m);
  assert.doesNotMatch(english, /^### Layered memory$/m);
});

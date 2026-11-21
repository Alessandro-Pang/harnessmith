import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import { execaSync } from 'execa';
import { fdir } from 'fdir';
import type { Adapter, AgentName } from '../shared/types.js';
import { errorMessage, HarnessmithError } from '../shared/types.js';
import { harnessTemplateRoot, installationRenderer } from './install-template.js';

const skillsCli = createRequire(import.meta.url).resolve('skills/bin/cli.mjs');

const agentDetectionVariables = [
  'AI_AGENT',
  'ANTIGRAVITY_AGENT',
  'AUGMENT_AGENT',
  'CLAUDECODE',
  'CLAUDE_CODE',
  'CLAUDE_CODE_IS_COWORK',
  'CODEX_CI',
  'CODEX_SANDBOX',
  'CODEX_THREAD_ID',
  'COPILOT_ALLOW_ALL',
  'COPILOT_GITHUB_TOKEN',
  'COPILOT_MODEL',
  'CURSOR_AGENT',
  'CURSOR_EXTENSION_HOST_ROLE',
  'CURSOR_TRACE_ID',
  'GEMINI_CLI',
  'OPENCODE_CLIENT',
  'REPL_ID',
] as const;

export function resolveSkillsHome(
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform = process.platform,
): string {
  return platform === 'win32' ? env.USERPROFILE || homedir() : env.HOME || homedir();
}

function skillsAgentName(name: AgentName): string {
  switch (name) {
    case 'claude':
      return 'claude-code';
    case 'kimi':
      return 'kimi-code-cli';
    case 'deepseek':
      // skills@1.7.6 has no DeepSeek id; DSH scans the shared ~/.agents/skills root.
      return 'pi';
    default:
      return name;
  }
}

function skillScopes(adapters: Adapter[]) {
  const global = adapters.filter((adapter) => !adapter.project);
  const projects = new Map<string, Adapter[]>();
  for (const adapter of adapters.filter(({ project }) => project)) {
    const project = adapter.project as string;
    projects.set(project, [...(projects.get(project) || []), adapter]);
  }
  return [
    ...(global.length > 0 ? [{ adapters: global, global: true, cwd: process.cwd() }] : []),
    ...[...projects].map(([cwd, projectAdapters]) => ({
      adapters: projectAdapters,
      global: false,
      cwd,
    })),
  ];
}

function renderedSkillSource(scope: { adapters: Adapter[] }, env: NodeJS.ProcessEnv): string {
  const stage = mkdtempSync(join(tmpdir(), 'harnessmith-skill-source-'));
  const source = join(stage, 'agent-harness');
  cpSync(harnessTemplateRoot, source, { recursive: true, errorOnExist: true });
  const [adapter] = scope.adapters;
  if (!adapter) throw new Error('Cannot render a skill without an adapter');
  const render = installationRenderer(adapter.userData, env);
  const files = new fdir({ excludeSymlinks: true })
    .withFullPaths()
    .withErrors()
    .filter((path, isDirectory) => !isDirectory && /\.(?:md|json|ya?ml)$/.test(path))
    .crawl(source)
    .sync();
  for (const path of files) {
    writeFileSync(path, render(readFileSync(path, 'utf8'), path.slice(source.length + 1)));
  }
  return source;
}

function runSkills(
  action: 'add' | 'remove',
  scope: { adapters: Adapter[]; global: boolean; cwd: string },
  env: NodeJS.ProcessEnv,
): void {
  const childEnv: NodeJS.ProcessEnv = {
    ...env,
    DISABLE_TELEMETRY: '1',
    DO_NOT_TRACK: '1',
    NO_COLOR: '1',
  };
  for (const name of agentDetectionVariables) delete childEnv[name];
  let stage: string | null = null;
  try {
    const args = [skillsCli, action];
    if (action === 'add') {
      const source = renderedSkillSource(scope, env);
      stage = join(source, '..');
      args.push(source, '--skill', 'agent-harness');
    } else args.push('agent-harness');
    if (scope.global) args.push('--global');
    args.push(
      '--agent',
      ...new Set(scope.adapters.map((adapter) => skillsAgentName(adapter.name))),
      '--yes',
    );
    execaSync(process.execPath, args, {
      cwd: scope.cwd,
      env: childEnv,
      extendEnv: false,
      encoding: 'utf8',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
    });
  } catch (error) {
    throw new HarnessmithError(
      'INTEGRITY_ERROR',
      `skills ${action} failed for ${scope.adapters.map(({ name }) => name).join(', ')}: ${errorMessage(error)}`,
      3,
      { cause: error instanceof Error ? error : undefined },
    );
  } finally {
    if (stage) rmSync(stage, { recursive: true, force: true });
  }
}

export function installSkills(adapters: Adapter[], env: NodeJS.ProcessEnv): void {
  for (const scope of skillScopes(adapters)) runSkills('add', scope, env);
}

export function uninstallSkills(
  adapters: Adapter[],
  env: NodeJS.ProcessEnv,
  installedPeers: Adapter[] = [],
): void {
  for (const scope of skillScopes(adapters)) {
    const sharedSkill = join(resolveSkillsHome(env), '.agents', 'skills', 'agent-harness');
    const sharedSkillExisted = scope.global && existsSync(sharedSkill);
    runSkills('remove', scope, env);
    const remainingGlobalPeers = installedPeers.filter((adapter) => !adapter.project);
    if (sharedSkillExisted && !existsSync(sharedSkill) && remainingGlobalPeers.length > 0) {
      // skills cannot detect every installed Adapter or custom home. Restore the shared copy only
      // when its removal deleted a skill that a peer still owns; withScopeLocks already covers peers.
      installSkills(remainingGlobalPeers, env);
    }
  }
}

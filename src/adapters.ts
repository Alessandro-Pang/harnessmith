import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { canonicalPath } from './safe-path.js';
import type { Adapter, AdapterCapabilities, AgentName } from './types.js';
import { HarnessmithError } from './types.js';

export function adapterCapabilities(name: AgentName): AdapterCapabilities {
  const cursor = name === 'cursor';
  return {
    scope: cursor ? 'project' : 'global',
    instructionFormat: cursor ? 'mdc' : 'markdown',
    nativeRuleActivation: cursor ? 'always' : 'host-default',
    enforcement: {
      fileOwnership: 'harnessmith',
      instructions: 'advisory',
      permissions: 'host-owned',
    },
  };
}

function projectRoot(input: string): string {
  const requested = resolve(input);
  if (!existsSync(requested))
    throw new HarnessmithError('CLI_USAGE', `Project path does not exist: ${requested}`, 2);
  if (!statSync(requested).isDirectory())
    throw new HarnessmithError('CLI_USAGE', `Project path is not a directory: ${requested}`, 2);
  try {
    return canonicalPath(
      execFileSync('git', ['-C', requested, 'rev-parse', '--show-toplevel'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim(),
    );
  } catch {
    return canonicalPath(requested);
  }
}

function plainInstructions(content: string): string {
  return `<!-- managed-by: harnessmith -->\n\n${content}`;
}

function mdcInstructions(content: string): string {
  return `---\ndescription: Personal coding agent harness\nglobs:\nalwaysApply: true\n---\n\n<!-- managed-by: harnessmith -->\n\n${content}`;
}

function gitExcludePath(root: string): string | null {
  try {
    const path = execFileSync('git', ['-C', root, 'rev-parse', '--git-path', 'info/exclude'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return resolve(root, path);
  } catch {
    return null;
  }
}

export function createAdapter(
  name: AgentName,
  {
    env = process.env,
    project = process.cwd(),
  }: { env?: NodeJS.ProcessEnv; project?: string } = {},
): Adapter {
  const home = canonicalPath(env.HOME || homedir());
  if (name === 'codex') {
    const agentHome = canonicalPath(env.CODEX_HOME || join(home, '.codex'));
    return {
      name,
      label: 'Codex',
      home: agentHome,
      harness: join(agentHome, 'agent-harness'),
      record: join(agentHome, '.harnessmith', 'install.json'),
      capabilities: adapterCapabilities(name),
      instructions: [{ path: join(agentHome, 'AGENTS.md'), render: plainInstructions }],
    };
  }
  if (name === 'claude') {
    const agentHome = canonicalPath(env.CLAUDE_CONFIG_DIR || join(home, '.claude'));
    return {
      name,
      label: 'Claude Code',
      home: agentHome,
      harness: join(agentHome, 'agent-harness'),
      record: join(agentHome, '.harnessmith', 'install.json'),
      capabilities: adapterCapabilities(name),
      instructions: [
        { path: join(agentHome, 'AGENTS.md'), render: plainInstructions },
        { path: join(agentHome, 'CLAUDE.md'), render: plainInstructions },
      ],
    };
  }
  if (name === 'cursor') {
    const root = projectRoot(project);
    const agentHome = join(root, '.cursor');
    const excludePath = gitExcludePath(root);
    return {
      name,
      label: 'Cursor',
      home: agentHome,
      project: root,
      harness: join(agentHome, 'agent-harness'),
      record: join(agentHome, '.harnessmith', 'install.json'),
      capabilities: adapterCapabilities(name),
      instructions: [
        { path: join(agentHome, 'AGENTS.md'), render: plainInstructions },
        { path: join(agentHome, 'rules', 'agent-harness.mdc'), render: mdcInstructions },
      ],
      localIgnoreFiles: [
        ...(excludePath
          ? [
              {
                path: excludePath,
                root: dirname(excludePath),
                preserveEmpty: true,
                lines: [
                  '/.cursor/agent-harness/',
                  '/.cursor/AGENTS.md',
                  '/.cursor/.harnessmith/',
                  '/.cursor/.harnessmith-stage-*',
                  '/.cursor/.harnessmith-restore-*',
                  '/.cursor/.harnessmith-operation.lock',
                  '/.cursor/.ignore',
                  '/.cursor/rules/agent-harness.mdc',
                  '/.cursor/*.backup-*',
                  '/.cursor/rules/agent-harness.mdc.backup-*',
                ],
              },
            ]
          : []),
        {
          path: join(agentHome, '.ignore'),
          lines: [
            '/agent-harness/',
            '/AGENTS.md',
            '/.harnessmith/',
            '/.harnessmith-stage-*',
            '/.harnessmith-restore-*',
            '/.harnessmith-operation.lock',
            '/rules/agent-harness.mdc',
            '/*.backup-*',
            '/rules/agent-harness.mdc.backup-*',
          ],
        },
      ],
    };
  }
  throw new HarnessmithError('CLI_USAGE', `Unsupported agent: ${name}`, 2);
}

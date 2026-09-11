import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { supportedAgentNames } from '../../packages/cli/src/adapters/adapter-registry.js';
import { withTemporaryWorkspace } from '../../packages/cli/src/temporary-resources/temporary-resource.js';

type Check = (condition: unknown, message: string) => void;
type RunNode = (entry: string, args: string[], env?: NodeJS.ProcessEnv) => string;

interface AdapterOutput {
  path?: string;
}

interface AdapterResult {
  adapter?: string;
  harness?: string | null;
  record?: string;
  hub?: { home?: string; record?: string; owners?: string[] };
  outputs?: AdapterOutput[];
}

function jsonLines<T>(output: string): T[] {
  return output
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

export function checkAdapterSet(
  actual: Array<string | undefined>,
  subject: string,
  check: Check,
): void {
  check(
    JSON.stringify(actual) === JSON.stringify(supportedAgentNames),
    `${subject} did not cover every registered adapter: ${actual.join(', ')}`,
  );
}

function checkDryRun(
  outerCli: string,
  project: string,
  env: NodeJS.ProcessEnv,
  runNode: RunNode,
  check: Check,
): void {
  const plans = jsonLines<{ adapter?: string; home?: string; outputs?: AdapterOutput[] }>(
    runNode(
      outerCli,
      ['install', '--agent', 'all', '--project', project, '--dry-run', '--yes', '--json'],
      env,
    ),
  );
  checkAdapterSet(
    plans.map(({ adapter }) => adapter),
    'outer CLI dry-run',
    check,
  );
  for (const plan of plans) {
    check(Boolean(plan.outputs?.length), `outer CLI dry-run omitted ${plan.adapter} outputs`);
    check(
      Boolean(plan.home) && !existsSync(plan.home as string),
      `outer CLI dry-run unexpectedly wrote the ${plan.adapter} home`,
    );
  }
}

function checkInstall(
  outerCli: string,
  project: string,
  env: NodeJS.ProcessEnv,
  runNode: RunNode,
  check: Check,
): AdapterResult[] {
  const installation = JSON.parse(
    runNode(
      outerCli,
      ['install', '--agent', 'all', '--project', project, '--no-init-global', '--yes', '--json'],
      env,
    ),
  ) as { command?: string; results?: AdapterResult[] };
  check(installation.command === 'install', 'outer CLI install returned the wrong command');
  const results = installation.results || [];
  checkAdapterSet(
    results.map(({ adapter }) => adapter),
    'outer CLI install',
    check,
  );
  for (const result of results) {
    const hubHarness = join(result.hub?.home || '', 'skills', 'agent-harness');
    check(existsSync(result.record || ''), `${result.adapter} install record was not created`);
    check(existsSync(result.hub?.record || ''), `${result.adapter} hub record was not created`);
    // Owner ids are `<agent>` for global hosts and `<agent>:<project>` for project hosts.
    check(
      Boolean(
        result.hub?.owners?.some(
          (owner) => owner === result.adapter || owner.startsWith(`${result.adapter}:`),
        ),
      ),
      `${result.adapter} is not recorded as a hub owner`,
    );
    check(
      !existsSync(join(hubHarness, 'packages/cli/src')),
      'hub Harness unexpectedly contains TypeScript sources',
    );
    // Hosts that do not scan ~/.agents/skills receive a symlink; verify the link resolves.
    const entry = result.harness ? join(result.harness, 'scripts', 'harness.mjs') : null;
    if (entry) check(existsSync(entry), `${result.adapter} skill link does not resolve`);
    const validation = JSON.parse(
      runNode(entry || join(hubHarness, 'scripts', 'harness.mjs'), ['validate', '--json'], env),
    ) as { valid?: boolean };
    check(validation.valid === true, `${result.adapter} installed Harness validation did not pass`);
  }
  return results;
}

function checkStatus(
  outerCli: string,
  project: string,
  env: NodeJS.ProcessEnv,
  runNode: RunNode,
  check: Check,
): void {
  const statuses = jsonLines<{
    adapter?: string;
    installed?: boolean;
    outputs?: Array<{ status?: string }>;
  }>(runNode(outerCli, ['status', '--agent', 'all', '--project', project, '--yes', '--json'], env));
  checkAdapterSet(
    statuses.map(({ adapter }) => adapter),
    'outer CLI status',
    check,
  );
  for (const status of statuses) {
    check(status.installed === true, `${status.adapter} status did not report installed`);
    check(
      Boolean(status.outputs?.every(({ status: state }) => state === 'managed')),
      `${status.adapter} status did not report every output as managed`,
    );
  }
}

function checkUninstall(
  outerCli: string,
  project: string,
  env: NodeJS.ProcessEnv,
  results: AdapterResult[],
  runNode: RunNode,
  check: Check,
): void {
  const uninstalled = jsonLines<{ command?: string; adapter?: string }>(
    runNode(
      outerCli,
      ['uninstall', '--agent', 'all', '--project', project, '--yes', '--json'],
      env,
    ),
  );
  checkAdapterSet(
    uninstalled.map(({ adapter }) => adapter),
    'outer CLI uninstall',
    check,
  );
  for (const item of uninstalled)
    check(item.command === 'uninstall', `${item.adapter} returned the wrong uninstall command`);
  for (const result of results) {
    check(!existsSync(result.record || ''), `${result.adapter} install record survived uninstall`);
    for (const output of result.outputs || [])
      check(!existsSync(output.path || ''), `${result.adapter} managed output survived uninstall`);
  }
}

export function checkBuiltCliAdapters({
  outerCli,
  runNode,
  check,
}: {
  outerCli: string;
  runNode: RunNode;
  check: Check;
}): void {
  withTemporaryWorkspace(
    { owner: 'preflight', purpose: 'preflight', lifecycle: 'operation' },
    ({ path: temporary }) => {
      const project = join(temporary, 'project');
      mkdirSync(project, { recursive: true });
      const env = {
        ...process.env,
        HOME: temporary,
        CODEX_HOME: join(temporary, 'codex'),
        CLAUDE_CONFIG_DIR: join(temporary, 'claude'),
        OPENCODE_CONFIG_DIR: join(temporary, 'opencode'),
        KIMI_CODE_HOME: join(temporary, 'kimi'),
        HARNESS_MEMORY_HOME: join(temporary, 'memory'),
        HARNESS_REPOSITORY_ROOT: join(temporary, 'repositories'),
        HARNESS_OWNER: 'preflight',
      };
      checkDryRun(outerCli, project, env, runNode, check);
      const results = checkInstall(outerCli, project, env, runNode, check);
      checkStatus(outerCli, project, env, runNode, check);
      checkUninstall(outerCli, project, env, results, runNode, check);
    },
  );
}

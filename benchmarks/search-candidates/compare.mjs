import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { arch, cpus, homedir, platform, release, totalmem } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

function option(name, fallback) {
  const index = process.argv.indexOf(name);
  return index < 0 ? fallback : process.argv[index + 1];
}

function positiveInteger(value, name) {
  if (!/^[1-9]\d*$/u.test(value)) throw new Error(`${name} must be a positive integer`);
  return Number(value);
}

const sizes = option('--sizes', '1000,10000,50000')
  .split(',')
  .map((value) => positiveInteger(value, 'size'));
const iterations = positiveInteger(option('--iterations', '30'), 'iterations');
const output = option('--output', 'results/search-candidates.json');
const workspace = dirname(fileURLToPath(import.meta.url));
const repository = resolve(workspace, '..', '..');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: repository, encoding: 'utf8' }).trim();
const results = [];

function portableFailure(value) {
  const redacted = value.replaceAll(repository, '<repository>').replaceAll(homedir(), '<home>');
  if (redacted.length <= 8000) return redacted;
  return `${redacted.slice(0, 4000)}\n... <failure output truncated> ...\n${redacted.slice(-4000)}`;
}

for (const size of sizes) {
  for (const candidate of ['minisearch', 'orama']) {
    const child = spawnSync(
      process.execPath,
      ['--expose-gc', '--max-old-space-size=1024', 'candidate-worker.mjs', candidate, String(size), String(iterations)],
      {
        cwd: workspace,
        encoding: 'utf8',
        env: { ...process.env, BENCHMARK_COMMIT: commit },
        maxBuffer: 16 * 1024 * 1024,
        timeout: 10 * 60 * 1000,
      },
    );
    if (child.status === 0) {
      results.push(JSON.parse(child.stdout));
    } else {
      results.push({
        candidate,
        size,
        status: child.error?.code === 'ETIMEDOUT' ? 'timeout' : 'failed',
        exitCode: child.status,
        signal: child.signal,
        error: portableFailure(`${child.error?.message || ''}\n${child.stderr || ''}`.trim()),
      });
    }
  }
}

const report = {
  version: 2,
  generatedAt: new Date().toISOString(),
  repositoryCommit: commit,
  environment: {
    node: process.version,
    platform: platform(),
    release: release(),
    arch: arch(),
    cpu: cpus()[0]?.model || 'unknown',
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  command: `pnpm run benchmark -- --sizes ${sizes.join(',')} --iterations ${iterations}`,
  iterations,
  heapLimitMiBPerWorker: 1024,
  results,
};
const outputPath = resolve(workspace, output);
mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));

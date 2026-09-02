import { readFileSync } from 'node:fs';
import { Command } from 'commander';
import {
  comparePromptRouteBenchmarks,
  runPromptRouteBenchmark,
} from './prompt-route-benchmark-lib.js';
import type { PromptRouteBenchmarkReport } from './prompt-route-benchmark-types.js';

const program = new Command()
  .name('prompt-route-benchmark')
  .description('run the deterministic Prompt and documentation-route benchmark')
  .option('--json', 'write the versioned benchmark report')
  .option('--baseline-report <path>', 'compare against a report produced from the same corpus')
  .action((options: { json?: boolean; baselineReport?: string }) => {
    const report = runPromptRouteBenchmark();
    const comparison = options.baselineReport
      ? comparePromptRouteBenchmarks(
          report,
          JSON.parse(readFileSync(options.baselineReport, 'utf8')) as PromptRouteBenchmarkReport,
        )
      : undefined;
    if (options.json)
      console.log(JSON.stringify({ ...report, ...(comparison && { comparison }) }, null, 2));
    else {
      console.log(
        `${report.result}: Top-1 ${report.metrics.actionTop1Accuracy.value.toFixed(3)}, topic recall ${report.metrics.topicRecall.value.toFixed(3)}, forbidden ${report.metrics.forbiddenActionCount.value}`,
      );
    }
    if (report.result !== 'passed') process.exitCode = 1;
  });

program.parse();

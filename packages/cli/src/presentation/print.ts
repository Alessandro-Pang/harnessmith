import pc from 'picocolors';
import type { LifecyclePlan } from '../shared/lifecycle-types.js';
import type { AdapterStatus, InstallPlan, Io } from '../shared/types.js';

function printOutputs(outputs: InstallPlan['outputs'], io: Io): void {
  for (const { path, action } of outputs) {
    const label = action.padEnd(15);
    const state =
      action === 'conflict'
        ? pc.yellow(label)
        : action === 'create'
          ? pc.green(label)
          : pc.cyan(label);
    io.log(`  ${state} ${path}`);
  }
}

export function printPlans(plans: InstallPlan[], io: Io = console): void {
  for (const plan of plans) {
    io.log(`${pc.bold(plan.adapter)}  ${pc.dim(plan.home)}`);
    printOutputs(plan.outputs, io);
  }
}

export function printStatuses(statuses: AdapterStatus[], io: Io = console): void {
  for (const status of statuses) {
    io.log(
      `${pc.bold(status.adapter)}  ${status.installed ? pc.green('installed') : pc.dim('not installed')}`,
    );
    for (const output of status.outputs) {
      const label = output.status.padEnd(12);
      const state =
        output.status === 'managed'
          ? pc.green(label)
          : output.status === 'modified'
            ? pc.yellow(label)
            : pc.red(label);
      io.log(`  ${state} ${output.path}`);
    }
  }
}

export function printLifecyclePlans(
  plans: LifecyclePlan[],
  io: Io,
  machineReadable: boolean,
): void {
  if (machineReadable) {
    for (const plan of plans) io.log(JSON.stringify(plan));
    return;
  }
  for (const plan of plans) {
    io.log(`${plan.command} ${plan.adapter}  ${plan.home}`);
    for (const change of plan.changes) {
      io.log(
        `  ${change.action.padEnd(20)} ${change.path}${change.source ? ` <- ${change.source}` : ''}`,
      );
    }
  }
}

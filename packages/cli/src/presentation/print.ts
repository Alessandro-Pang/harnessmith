import pc from 'picocolors';
import type { AdapterStatus, InstallPlan, Io, LifecyclePlan } from '../shared/types.js';

function printOutputs(outputs: InstallPlan['outputs'], io: Io): void {
  for (const { path, action, kind, target } of outputs) {
    const label = action.padEnd(15);
    const state =
      action === 'conflict'
        ? pc.yellow(label)
        : action === 'create'
          ? pc.green(label)
          : pc.cyan(label);
    io.log(`  ${state} ${path}${kind === 'link' && target ? pc.dim(` -> ${target}`) : ''}`);
  }
}

/** The hub is shared by every plan, so it is printed once before the host layers. */
export function printPlans(plans: InstallPlan[], io: Io = console): void {
  const hub = plans[0]?.hub;
  if (hub) {
    io.log(`${pc.bold('hub')}  ${pc.dim(hub.home)}`);
    printOutputs(hub.outputs, io);
    for (const { path, action } of hub.migrations)
      io.log(`  ${pc.magenta(action.padEnd(15))} ${path}`);
  }
  for (const plan of plans) {
    io.log(`${pc.bold(plan.adapter)}  ${pc.dim(plan.home)}`);
    printOutputs(plan.outputs.slice(plan.hub.outputs.length), io);
    for (const { path, action } of plan.migrations.slice(plan.hub.migrations.length)) {
      io.log(`  ${pc.magenta(action.padEnd(15))} ${path}`);
    }
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
  const printLayers = (layers: LifecyclePlan['layers']): void => {
    for (const [index, layer] of layers.entries()) {
      io.log(`  layer ${index + 1}  ${layer.sourceRecord}`);
      for (const change of layer.changes) {
        io.log(
          `    ${change.action.padEnd(20)} ${change.path}${change.source ? ` <- ${change.source}` : ''}`,
        );
      }
    }
  };
  for (const plan of plans) {
    io.log(`${plan.command} ${plan.adapter}  ${plan.home}`);
    printLayers(plan.layers);
  }
  const hub = plans[0]?.hub;
  if (hub) {
    io.log(`${plans[0].command} hub  ${hub.home}  (${hub.action})`);
    printLayers(hub.layers);
  }
}

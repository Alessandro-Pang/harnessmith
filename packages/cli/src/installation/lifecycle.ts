import type { Adapter, InstallOptions } from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';
import { type HubLifecycleDecision, planHubLifecycle, releaseOwners } from './hub-lifecycle.js';
import { assertRestorable, assertUninstallable, installationLayers } from './lifecycle-plan.js';
import { restoreOnce } from './lifecycle-restore.js';
import {
  type LifecycleTransactionContext,
  lifecycleTransaction,
  mutableLifecyclePaths,
} from './lifecycle-transaction.js';
import { withScopeLocks } from './operation-lock.js';
import { assertNonOverlappingAdapters, readInstallRecord } from './records.js';

export { inspectStatusAll, statusAll } from '../status/status-inspection.js';

function hubMutablePaths(decision: HubLifecycleDecision) {
  if (decision.action === 'keep') return [];
  return mutableLifecyclePaths(decision.hub, installationLayers(decision.hub));
}

function applyHubDecision(
  decision: HubLifecycleDecision,
  transaction: LifecycleTransactionContext,
  options: Pick<InstallOptions, 'force'>,
): void {
  if (decision.action === 'release') releaseOwners(decision.hub, decision.releasing);
  if (decision.action !== 'unwind') return;
  for (let index = 0; index < decision.layers.length; index += 1) {
    restoreOnce(decision.hub, transaction, options);
  }
}

export function restoreAll(adapters: Adapter[], options: Pick<InstallOptions, 'force'> = {}) {
  assertNonOverlappingAdapters(adapters);
  const force = options.force || false;
  return withScopeLocks([...adapters, ...(adapters[0] ? [adapters[0].hub] : [])], () => {
    const layers = adapters.map((adapter) => {
      const current = installationLayers(adapter)[0];
      if (!current)
        throw new HarnessmithError(
          'STATE_CONFLICT',
          `No Harnessmith installation found for ${adapter.label}: ${adapter.record}`,
          5,
        );
      assertRestorable(adapter, current.record, force);
      return { adapter, layers: [current] };
    });
    const decision = planHubLifecycle('restore', adapters, force);
    return lifecycleTransaction(
      [
        ...layers.flatMap(({ adapter, layers: records }) =>
          mutableLifecyclePaths(adapter, records),
        ),
        ...hubMutablePaths(decision),
      ],
      (transaction) => {
        const results = layers.map(({ adapter }) => ({
          adapter: adapter.name,
          restored: restoreOnce(adapter, transaction, options),
        }));
        applyHubDecision(decision, transaction, options);
        return results.map((result) => ({ ...result, hub: decision.action }));
      },
    );
  });
}

export function uninstallAll(adapters: Adapter[], options: Pick<InstallOptions, 'force'> = {}) {
  assertNonOverlappingAdapters(adapters);
  const force = options.force || false;
  return withScopeLocks([...adapters, ...(adapters[0] ? [adapters[0].hub] : [])], () => {
    const plans = adapters.map((adapter) => {
      const layers = installationLayers(adapter);
      assertUninstallable(adapter, layers, force);
      return { adapter, layers };
    });
    const decision = planHubLifecycle('uninstall', adapters, force);
    return lifecycleTransaction(
      [
        ...plans.flatMap(({ adapter, layers }) => mutableLifecyclePaths(adapter, layers)),
        ...hubMutablePaths(decision),
      ],
      (transaction) => {
        const results = plans.map(({ adapter }) => {
          let layers = 0;
          while (readInstallRecord(adapter)) {
            restoreOnce(adapter, transaction, options);
            layers += 1;
          }
          return { adapter: adapter.name, layers };
        });
        applyHubDecision(decision, transaction, options);
        return results.map((result) => ({
          ...result,
          hub: decision.action,
          hubLayers: decision.layers.length,
        }));
      },
    );
  });
}

import { readFileSync } from 'node:fs';
import { atomicWrite } from '../shared/files.js';
import { assertSafePath } from '../shared/safe-path.js';
import type {
  Adapter,
  Hub,
  InstallRecord,
  LifecycleCommand,
  LifecyclePlan,
} from '../shared/types.js';
import { HarnessmithError } from '../shared/types.js';
import { hubOwnerId, ownerAgentName, sharedHub } from './hub.js';
import {
  assertRestorable,
  assertUninstallable,
  describeLayer,
  installationLayers,
  type RecordLayer,
} from './lifecycle-plan.js';
import { hubOwners } from './records.js';

/**
 * How a host lifecycle command affects the shared hub:
 *
 * - `keep`: other hosts still own the hub and this host keeps a record layer.
 * - `release`: the hosts leave the owners list; the hub content is untouched.
 * - `unwind`: the listed hub layers are restored. `restore` unwinds the hub layer written
 *   by the same install transaction as the host layer (all hosts of that transaction must
 *   be restored together); `uninstall` unwinds every hub layer once the last owner leaves.
 */
export interface HubLifecycleDecision {
  hub: Hub;
  action: 'keep' | 'release' | 'unwind';
  layers: RecordLayer[];
  /** Hub owner ids (see `hubOwnerId`) leaving the owners list. */
  releasing: string[];
}

function topRecord(adapter: Adapter): InstallRecord | null {
  return installationLayers(adapter)[0]?.record ?? null;
}

function requireInstalled(adapter: Adapter, record: InstallRecord | null): InstallRecord {
  if (!record) {
    throw new HarnessmithError(
      'STATE_CONFLICT',
      `No Harnessmith installation found for ${adapter.label}: ${adapter.record}`,
      5,
    );
  }
  return record;
}

export function planHubLifecycle(
  command: LifecycleCommand,
  adapters: Adapter[],
  force = false,
): HubLifecycleDecision {
  const hub = sharedHub(adapters);
  const hubLayers = installationLayers(hub);
  const top = hubLayers[0];
  const selected = adapters.map(hubOwnerId);
  if (!top) return { hub, action: 'keep', layers: [], releasing: [] };
  if (command === 'uninstall') {
    const remaining = hubOwners(top.record).filter((owner) => !selected.includes(owner));
    if (remaining.length > 0) return { hub, action: 'release', layers: [], releasing: selected };
    assertUninstallable(hub, hubLayers, force);
    return { hub, action: 'unwind', layers: hubLayers, releasing: selected };
  }
  const records = adapters.map((adapter) => requireInstalled(adapter, topRecord(adapter)));
  const sameTransaction = records.some(
    ({ stamp }) => stamp !== undefined && stamp === top.record.stamp,
  );
  if (sameTransaction) {
    // `installed` is the historical transaction roster and is never pruned, so a host that has
    // since uninstalled would otherwise be demanded here and could never be supplied again.
    const owners = hubOwners(top.record);
    const missing = (top.record.installed ?? []).filter(
      (owner) => !selected.includes(owner) && owners.includes(owner),
    );
    if (missing.length > 0) {
      const agents = [...new Set([...selected, ...missing].map(ownerAgentName))];
      throw new HarnessmithError(
        'STATE_CONFLICT',
        `The latest hub layer was installed together with ${missing.join(', ')}; restore those agents in the same command (${agents.map((name) => `--agent ${name}`).join(' ')})`,
        5,
      );
    }
    assertRestorable(hub, top.record, force);
    return { hub, action: 'unwind', layers: [top], releasing: [] };
  }
  const releasing = adapters
    .filter((adapter) => installationLayers(adapter).length === 1)
    .map(hubOwnerId);
  return { hub, action: releasing.length > 0 ? 'release' : 'keep', layers: [], releasing };
}

/** Drop owners from every hub layer so a later unwind never revives them. */
export function releaseOwners(hub: Hub, releasing: string[]): void {
  if (releasing.length === 0) return;
  for (const layer of installationLayers(hub)) {
    assertSafePath(hub.home, layer.path);
    const record = JSON.parse(readFileSync(layer.path, 'utf8')) as InstallRecord;
    const owners = hubOwners(record).filter((owner) => !releasing.includes(owner));
    atomicWrite(layer.path, `${JSON.stringify({ ...record, owners }, null, 2)}\n`);
  }
}

export function describeLifecycle(
  command: LifecycleCommand,
  adapter: Adapter,
  force = false,
  selected: Adapter[] = [adapter],
): LifecyclePlan {
  const layers = installationLayers(adapter);
  if (command === 'restore') {
    const current = layers[0];
    if (!current)
      throw new HarnessmithError(
        'STATE_CONFLICT',
        `No Harnessmith installation found for ${adapter.label}: ${adapter.record}`,
        5,
      );
    assertRestorable(adapter, current.record, force);
  } else {
    assertUninstallable(adapter, layers, force);
  }
  const decision = planHubLifecycle(command, selected, force);
  return {
    command,
    adapter: adapter.name,
    capabilities: adapter.capabilities,
    home: adapter.home,
    layers: (command === 'restore' ? layers.slice(0, 1) : layers).map((layer) =>
      describeLayer(adapter, layer),
    ),
    hub: {
      home: decision.hub.home,
      action: decision.action,
      layers: decision.layers.map((layer) => describeLayer(decision.hub, layer)),
    },
  };
}

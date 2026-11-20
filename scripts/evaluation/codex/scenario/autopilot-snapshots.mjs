import { existsSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 */
export function buildAutopilotSnapshots(context) {
  const { repo, snapshot, scalar, markdownFiles, turnByLabel } = context;
  const inputRoot = join(repo, '.agent-docs', 'inputs');
  const inputs = existsSync(inputRoot)
    ? markdownFiles(inputRoot).map((path) => ({ path, content: readFileSync(path, 'utf8') }))
    : [];
  const acceptance =
    'Acceptance: node verify-autopilot.mjs apps/docs/site/status.txt exits 0 and no other tracked file changes.';
  const matchingInputs = inputs.filter(({ content }) => content.includes(acceptance));
  const core = readFileSync(join(repo, '.agent-docs', 'core.md'), 'utf8');
  const initialCore = turnByLabel.get('initial')?.observation.projectCore ?? '';
  const initialHandoff = snapshot('initial', 'host-thread-42');
  const pre = snapshot('pre-compaction-signal', 'host-thread-42');
  const follow = snapshot('follow-up-edit', 'host-thread-42');
  const repeated = snapshot('repeat-identical-checkpoint', 'host-thread-42');
  const pause = turnByLabel.get('pause-profile')?.observation;
  const pausedPreference = turnByLabel.get('preference-while-paused')?.observation;
  const forgot = turnByLabel.get('forget-profile')?.observation;
  const explicitPausedUpdate = turnByLabel.get('explicit-profile-update-while-paused')?.observation;
  const closed = snapshot('close-work', 'host-thread-42');
  const matchingInput = matchingInputs.length === 1 ? matchingInputs[0] : null;
  const matchingInputReference = matchingInput
    ? `memory:${relative(join(repo, '.agent-docs'), matchingInput.path).replace(/\.md$/, '')}`
    : null;
  const exactInputIndexed = Boolean(
    matchingInput &&
      scalar(matchingInput.content, 'memory-kind') === 'input' &&
      scalar(matchingInput.content, 'input-source') === 'chat' &&
      scalar(matchingInput.content, 'verbatim') === 'true' &&
      (initialCore.match(
        new RegExp((matchingInputReference ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g'),
      )?.length ?? 0) === 1,
  );
  return {
    core,
    initialHandoff,
    pre,
    follow,
    repeated,
    pause,
    pausedPreference,
    forgot,
    explicitPausedUpdate,
    closed,
    matchingInput,
    matchingInputReference,
    acceptance,
    exactInputIndexed,
  };
}

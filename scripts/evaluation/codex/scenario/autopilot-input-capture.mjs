import {
  memoryPayloadOutputIsCompatible,
  sameCanonicalPath,
  selectSingleSuccessfulMemoryPayloadInvocation,
  typedInputCaptureIsProven,
} from '../eval-codex-support.mjs';

/**
 * @param {import('./assertion-types.mjs').AssertionContext} context
 * @param {ReturnType<typeof import('./autopilot-snapshots.mjs').buildAutopilotSnapshots>} state
 */
export function buildAutopilotInputCapture(context, state) {
  const { memoryPayloadInvocations } = context;
  const { matchingInput, matchingInputReference, acceptance } = state;
  const captureInputInvocations = memoryPayloadInvocations.filter(
    (item) => item.turn === 'initial' && item.action === 'capture-input',
  );
  const captureInputInvocation = selectSingleSuccessfulMemoryPayloadInvocation(
    memoryPayloadInvocations,
    {
      turn: 'initial',
      action: 'capture-input',
      outputActions: ['created'],
      allowUnobserved: true,
    },
  );
  const captureOutputCompatible = Boolean(
    memoryPayloadOutputIsCompatible(captureInputInvocation?.output, {
      kind: 'input',
      actions: ['created'],
      allowUnobserved: captureInputInvocation?.outputObserved === false,
    }) &&
      (captureInputInvocation?.output == null ||
        (matchingInput &&
          sameCanonicalPath(captureInputInvocation.output.path, matchingInput.path) &&
          captureInputInvocation.output.reference === matchingInputReference)),
  );
  const typedInputCaptureProven = typedInputCaptureIsProven({
    invocations: memoryPayloadInvocations,
    invocation: captureInputInvocation,
    acceptance,
    outputCompatible: captureOutputCompatible,
  });
  return { captureInputInvocations, typedInputCaptureProven };
}

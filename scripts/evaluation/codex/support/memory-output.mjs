/**
 * @param {import('./types.mjs').MemoryPayloadOutput | null | undefined} output
 * @param {{ kind: string, actions: string[], allowUnobserved?: boolean }} options
 */
export function memoryPayloadOutputIsCompatible(
  output,
  { kind, actions, allowUnobserved = false },
) {
  if (output === null || output === undefined) return allowUnobserved;
  return (
    output.version === 1 &&
    output.kind === kind &&
    typeof output.action === 'string' &&
    new Set(actions).has(output.action)
  );
}

/**
 * Neutral task identifier contract. Memory handoff options and the task store both
 * validate task ids; keeping the rule here avoids a memory <-> task import cycle.
 */
export function assertTaskId(id: string): void {
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(id)) throw new Error(`Invalid task id: ${id}`);
}

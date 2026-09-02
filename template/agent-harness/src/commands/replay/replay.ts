import { readBoundedRegularFile } from '../../lib/filesystem/bounded-file.js';
import {
  evaluateReplayContract,
  type ReplayContractInput,
  type ReplayContractReport,
} from '../../lib/replay/replay-contract.js';
import { assertNoHighConfidenceSecretInValue } from '../../lib/security/secret-hygiene.js';
import type { Io } from '../../types.js';

const maximumReplayPayloadBytes = 256 * 1024;

export function verifyReplay(
  payloadFile: string,
  { json = false }: { json?: boolean } = {},
  io: Io = console,
): ReplayContractReport {
  if (!payloadFile?.trim()) throw new Error('Replay verification requires --payload-file <path>');
  const payload = readBoundedRegularFile(payloadFile, {
    maxBytes: maximumReplayPayloadBytes,
    subject: 'Replay verification payload',
  });
  let input: unknown;
  try {
    input = JSON.parse(payload.content);
  } catch (error) {
    throw new Error(`Replay verification payload contains invalid JSON: ${payload.path}`, {
      cause: error,
    });
  }
  assertNoHighConfidenceSecretInValue(input, 'Replay verification payload');
  const report = evaluateReplayContract(input as ReplayContractInput);
  if (json) io.log(JSON.stringify(report, null, 2));
  else io.log(`${report.result}: ${report.decision} (${report.reasonCode})`);
  return report;
}

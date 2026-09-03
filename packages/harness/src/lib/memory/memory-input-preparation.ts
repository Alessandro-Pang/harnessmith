import { normalizedInputContent } from '../../lib/memory/memory-input.js';
import {
  type InputOptions,
  inputPayload,
  maximumInputContentBytes,
  type ResolvedInputPolicy,
  resolveInputPolicy,
} from '../../lib/memory/memory-input-policy.js';
import { assertNoHighConfidenceSecret } from '../../lib/security/secret-hygiene.js';

export interface PreparedInput {
  policy: ResolvedInputPolicy;
  title: string;
  storedPayload: string;
  summary: boolean;
}

export function prepareInput(project: string, options: InputOptions): PreparedInput {
  const policy = resolveInputPolicy(options);
  assertNoHighConfidenceSecret(
    [
      project,
      options.title,
      options.content,
      options.contentFile,
      options.source,
      policy.mode,
      policy.purpose,
      policy.retention,
      policy.workstream,
      ...(options.scope || []),
      ...(options.sourceRefs || []),
    ],
    'Memory input request',
  );
  const payload = inputPayload(options);
  if (Buffer.byteLength(payload) > maximumInputContentBytes) {
    throw new Error(
      `Input content exceeds ${maximumInputContentBytes} bytes; capture a bounded reliable summary instead`,
    );
  }
  assertNoHighConfidenceSecret([payload], 'Memory input');
  const title = options.title.trim();
  if (!title || title.length > 200 || /[\r\n]/.test(title) || !payload.trim()) {
    if (/[\r\n]/.test(title)) throw new Error('Input title must be a single line');
    throw new Error('Input title and content are required');
  }
  if (!['chat', 'file', 'meeting', 'link', 'other'].includes(options.source))
    throw new Error(`Invalid input source: ${options.source}`);
  const summary = policy.mode === 'summary';
  return {
    policy,
    title,
    storedPayload: summary ? normalizedInputContent(payload) : payload,
    summary,
  };
}

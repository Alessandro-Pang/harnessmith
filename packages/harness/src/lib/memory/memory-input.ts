import { createHash } from 'node:crypto';

export type InputSource = 'chat' | 'file' | 'meeting' | 'link' | 'other';

export interface ParsedInputBody {
  content: string;
  verbatim: boolean;
}

export function normalizedInputContent(value: string): string {
  return value.normalize('NFKC').replace(/\r\n?/g, '\n').trim();
}

export function inputContentDigest(value: string, source: InputSource, verbatim: boolean): string {
  return createHash('sha256')
    .update(verbatim ? value : normalizedInputContent(value))
    .update(`\0input-source:${source}\0verbatim:${String(verbatim)}`)
    .digest('hex');
}

/**
 * Source references are pointers, not arbitrary filesystem locations. Keep
 * them portable and bounded so a finding/experience can be traced without
 * allowing an absolute path or a traversal target to escape the project.
 * Prefix references (for example `task:`, `memory:` and `verifier:`) keep
 * their opaque payload, but memory references still use a relative path.
 */
export function assertSourceReferenceBoundary(
  references: readonly string[],
  label: 'Finding' | 'Experience',
): void {
  for (const reference of references) {
    if (typeof reference !== 'string') {
      throw new Error(`${label} source references must be bounded strings`);
    }
    const value = reference.trim();
    if (/^(?:\/|\\\\|~\/|[A-Za-z]:[\\/])/.test(value)) {
      throw new Error(`${label} source references must be project-relative or typed pointers`);
    }
    const separator = value.indexOf(':');
    if (separator < 0) {
      if (value.split('/').includes('..') || value.split('\\').includes('..')) {
        throw new Error(`${label} source references cannot contain path traversal`);
      }
      continue;
    }
    const scheme = value.slice(0, separator).toLowerCase();
    const payload = value.slice(separator + 1).trim();
    if (!/^[a-z][a-z0-9+.-]*$/i.test(scheme) || payload.length === 0) {
      throw new Error(`${label} source references must contain a non-empty typed pointer`);
    }
    if (
      scheme === 'memory' &&
      (payload.startsWith('/') || payload.split(/[\\/]/u).includes('..'))
    ) {
      throw new Error(`${label} memory source references must stay project-relative`);
    }
  }
}

export function parseInputBody(body: string): ParsedInputBody | undefined {
  const match = body.match(/^\r?\n?# (原始输入|可靠摘要)\r?\n\r?\n([\s\S]*)$/);
  if (!match) return undefined;
  return { content: match[2], verbatim: match[1] === '原始输入' };
}

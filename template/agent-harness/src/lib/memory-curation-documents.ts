import { parseFrontmatterDocument } from './frontmatter.js';
import { markdownFiles, memoryReference, readMemoryDocument } from './memory-path.js';
import {
  contentMemoryReferences,
  isOpaqueMemoryContent,
  metadataReferences,
} from './memory-validation.js';

export interface CurationDocument {
  reference: string;
  name: string;
  type: string;
  kind: string;
  status: string;
  expires?: string;
  retention?: string;
  workstream?: string;
  session?: string;
  sourceRefs: string[];
  references: string[];
}

export function canonicalMemoryReference(reference: string): string {
  return reference
    .replace(/^memory:/, '')
    .replace(/\.md$/, '')
    .toLowerCase();
}

function optionalString(metadata: Map<string, unknown>, field: string): string | undefined {
  const value = metadata.get(field);
  return typeof value === 'string' ? value : undefined;
}

export function loadCurationDocuments(memoryRoot: string): CurationDocument[] {
  return markdownFiles(memoryRoot, { archive: false }).map((path) => {
    const content = readMemoryDocument(path);
    const parsed = parseFrontmatterDocument(content);
    const sourceRefs = parsed.metadata.get('source-refs');
    const bodyReferences = isOpaqueMemoryContent(parsed.metadata, { root: memoryRoot, path })
      ? []
      : contentMemoryReferences(content);
    return {
      reference: `memory:${memoryReference(memoryRoot, path)}`,
      name: memoryReference(memoryRoot, path),
      type: String(parsed.metadata.get('type') || ''),
      kind: String(parsed.metadata.get('memory-kind') || ''),
      status: String(parsed.metadata.get('status') || ''),
      expires: optionalString(parsed.metadata, 'expires'),
      retention: optionalString(parsed.metadata, 'retention'),
      workstream: optionalString(parsed.metadata, 'workstream'),
      session: optionalString(parsed.metadata, 'session'),
      sourceRefs: Array.isArray(sourceRefs)
        ? sourceRefs.filter((entry): entry is string => typeof entry === 'string')
        : [],
      references: [...bodyReferences, ...metadataReferences(parsed.metadata)].map(
        canonicalMemoryReference,
      ),
    };
  });
}

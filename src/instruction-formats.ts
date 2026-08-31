/**
 * Instruction format extension points for Adapter-managed rule files.
 * Host path selection stays in adapters; this module only owns render shapes.
 * Future formats (for example host-native rule DSLs) register here beside markdown/mdc.
 */

export type InstructionFormatId = 'markdown' | 'mdc';

export interface InstructionFormatDefinition {
  readonly id: InstructionFormatId;
  readonly render: (content: string) => string;
}

export function renderMarkdownInstructions(content: string): string {
  return `<!-- managed-by: harnessmith -->\n\n${content}`;
}

export function renderMdcInstructions(content: string): string {
  return `---\ndescription: Personal coding agent harness\nglobs:\nalwaysApply: true\n---\n\n<!-- managed-by: harnessmith -->\n\n${content}`;
}

export const instructionFormats = {
  markdown: { id: 'markdown', render: renderMarkdownInstructions },
  mdc: { id: 'mdc', render: renderMdcInstructions },
} as const satisfies Record<InstructionFormatId, InstructionFormatDefinition>;

export function instructionRenderer(format: InstructionFormatId): (content: string) => string {
  return instructionFormats[format].render;
}

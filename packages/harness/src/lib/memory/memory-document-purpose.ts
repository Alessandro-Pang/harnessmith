type DocumentPurposeDiagnosticCode =
  | 'invalid-purpose-schema'
  | 'missing-purpose'
  | 'invalid-purpose'
  | 'generic-title'
  | 'generic-description'
  | 'purpose-title-mismatch'
  | 'description-title-mismatch';

export interface DocumentPurposeDiagnostic {
  code: DocumentPurposeDiagnosticCode;
  severity: 'error' | 'warning';
}

export interface DocumentPurposeAnalysis {
  purpose: string | null;
  genericDescription: boolean;
  splitReasons: string[];
}

interface PurposeDocument {
  name: string;
  metadata: Map<string, unknown>;
  body: string;
}

const genericLabels = new Set([
  '相关内容',
  '任务信息',
  '相关信息',
  '其他内容',
  'related content',
  'task information',
  'related information',
  'miscellaneous',
  'notes',
]);

function normalizeDocumentPurpose(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase();
}

function isGeneric(value: unknown): boolean {
  return typeof value === 'string' && genericLabels.has(normalizeDocumentPurpose(value));
}

function validPurpose(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    value.length <= 200 &&
    !/[\r\n]/.test(value)
  );
}

export function documentPurposeMetadata(title: string) {
  return {
    'document-purpose': title.trim(),
    'document-purpose-schema-version': 1,
  } as const;
}

export function validateDocumentPurpose(
  metadata: Map<string, unknown>,
): DocumentPurposeDiagnostic[] {
  const diagnostics: DocumentPurposeDiagnostic[] = [];
  const schemaVersion = metadata.get('document-purpose-schema-version');
  const strict = schemaVersion !== undefined;
  const title = metadata.get('title');
  const description = metadata.get('description');
  const purpose = metadata.get('document-purpose');
  if (strict && schemaVersion !== 1) {
    diagnostics.push({ code: 'invalid-purpose-schema', severity: 'error' });
  }
  if (strict && purpose === undefined) {
    diagnostics.push({ code: 'missing-purpose', severity: 'error' });
  } else if (purpose !== undefined && !validPurpose(purpose)) {
    diagnostics.push({ code: 'invalid-purpose', severity: 'error' });
  }
  if (isGeneric(title)) {
    diagnostics.push({ code: 'generic-title', severity: strict ? 'error' : 'warning' });
  }
  if (isGeneric(description)) {
    diagnostics.push({ code: 'generic-description', severity: strict ? 'error' : 'warning' });
  }
  if (
    validPurpose(purpose) &&
    typeof title === 'string' &&
    normalizeDocumentPurpose(purpose) !== normalizeDocumentPurpose(title)
  ) {
    diagnostics.push({ code: 'purpose-title-mismatch', severity: 'error' });
  }
  if (
    strict &&
    typeof title === 'string' &&
    typeof description === 'string' &&
    !normalizeDocumentPurpose(description).includes(normalizeDocumentPurpose(title))
  ) {
    diagnostics.push({ code: 'description-title-mismatch', severity: 'error' });
  }
  return diagnostics;
}

export function analyzeDocumentPurpose(
  metadata: Map<string, unknown>,
  body: string,
): DocumentPurposeAnalysis {
  const explicit = metadata.get('document-purpose');
  const title = metadata.get('title');
  const purpose = validPurpose(explicit)
    ? explicit.trim()
    : typeof title === 'string' && title.trim()
      ? title.trim()
      : null;
  const purposeHeadings = body
    .split(/\r?\n/)
    .filter((line) =>
      /^# (结论|目的|当前目标|Conclusion|Purpose|Current Goal)$/iu.test(line.trim()),
    );
  return {
    purpose,
    genericDescription: isGeneric(metadata.get('description')),
    splitReasons: purposeHeadings.length > 1 ? ['multiple-purpose-headings'] : [],
  };
}

export function purposeMaintenanceDiagnostics(documents: PurposeDocument[]) {
  const purposes = new Map<string, { purpose: string; paths: string[] }>();
  const genericDescriptions: string[] = [];
  const splitProposals: Array<{ path: string; reasons: string[] }> = [];
  for (const { name, metadata, body } of documents) {
    if (!['active', 'blocked'].includes(String(metadata.get('status') || ''))) continue;
    const analysis = analyzeDocumentPurpose(metadata, body);
    if (analysis.genericDescription) genericDescriptions.push(name);
    if (analysis.splitReasons.length > 0) {
      splitProposals.push({ path: name, reasons: analysis.splitReasons });
    }
    if (!analysis.purpose) continue;
    const key = normalizeDocumentPurpose(analysis.purpose);
    const current = purposes.get(key) ?? { purpose: analysis.purpose, paths: [] };
    current.paths.push(name);
    purposes.set(key, current);
  }
  return {
    genericDescriptions: genericDescriptions.sort(),
    duplicatePurposes: [...purposes.values()]
      .filter(({ paths }) => paths.length > 1)
      .map(({ purpose, paths }) => ({ purpose, paths: paths.sort() }))
      .sort((left, right) => left.purpose.localeCompare(right.purpose)),
    splitProposals: splitProposals.sort((left, right) => left.path.localeCompare(right.path)),
  };
}

import type { TaskStatus } from '../types.js';
import {
  type CurationAction,
  createCurationProposal,
  curationWorkspaceDigest,
} from './memory-curation-contract.js';
import type { CurationDocument } from './memory-curation-documents.js';

interface RawCandidate {
  reference: string;
  reason: string;
}

export function buildCurationProposals(input: {
  project: string;
  documents: CurationDocument[];
  candidates: Record<CurationAction, RawCandidate[]>;
  expiresOn: string;
  task: string;
  taskStatus: TaskStatus;
  workstream: string;
  outcome: string;
}) {
  const workspaceDigest = curationWorkspaceDigest(input.project);
  const documents = new Map(input.documents.map((document) => [document.reference, document]));
  const build = (action: CurationAction, item: RawCandidate) => {
    const document = documents.get(item.reference);
    if (!document) throw new Error(`Curation candidate source disappeared: ${item.reference}`);
    return createCurationProposal({
      action,
      reference: item.reference,
      reason: item.reason,
      sourceDigest: document.sourceDigest,
      workspaceDigest,
      expiresOn: input.expiresOn,
      task: input.task,
      taskStatus: input.taskStatus,
      workstream: input.workstream,
      outcome: input.outcome,
    });
  };
  return {
    promote: input.candidates.promote.map((item) => build('promote', item)),
    close: input.candidates.close.map((item) => build('close', item)),
    supersede: input.candidates.supersede.map((item) => build('supersede', item)),
    archive: input.candidates.archive.map((item) => build('archive', item)),
  };
}

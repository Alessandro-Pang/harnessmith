export interface ManagedContentFingerprint {
  version: 1;
  algorithm: 'sha256';
  state: 'matched' | 'drifted' | 'unrecorded';
  recorded: string | null;
  current: string;
}

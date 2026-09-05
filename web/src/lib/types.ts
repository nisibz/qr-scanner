// Shared domain types for the QR scanner app.
// ScanRecord (the IndexedDB row shape) is defined in history-store.ts and
// re-exported here as the canonical history record type.

export type { ScanRecord as HistoryRecord } from './history-store';

export interface ParsedAction {
  kind: 'link' | 'copy' | 'download';
  label: string;
  primary?: boolean;
  href?: string;
  value?: string;
  filename?: string;
  content?: string;
  mime?: string;
}

export interface ParsedResult {
  type: string;
  label: string;
  title: string;
  fields: Array<{ label: string; value: string; monospace?: boolean }>;
  actions: ParsedAction[];
  safety?: { isSafe: boolean; reasons: string[] };
  raw: string;
}

export function truncate(s: string, n: number): string {
  if (!s) return '';
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}

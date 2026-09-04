/// <reference types="vite/client" />

declare module '@/lib/result-parser' {
  import type { ParsedResult } from '@/lib/app';
  export function parseResult(raw: string): ParsedResult;
}

declare module '@/lib/history-store' {
  export interface StoredScan {
    id?: number;
    content: string;
    type: string;
    label: string;
    createdAt: number;
  }
  export function isHistoryEnabled(): boolean;
  export function setHistoryEnabled(enabled: boolean): void;
  export function addScan(scan: { content: string; type: string; label: string }): Promise<StoredScan | null>;
  export function getAllScans(): Promise<StoredScan[]>;
  export function queryScans(opts?: { search?: string; type?: string }): Promise<StoredScan[]>;
  export function getScan(id: number): Promise<StoredScan | undefined>;
  export function removeScan(id: number): Promise<void>;
  export function clearAllScans(): Promise<void>;
  export function countScans(): Promise<number>;
  export function exportScans(): Promise<string>;
  export function exportScansCsv(): Promise<string>;
  export function importScans(json: unknown): Promise<number>;
  export function updateTitle(content: string, title: string): Promise<boolean>;
}

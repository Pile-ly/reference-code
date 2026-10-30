// Types for progress.js, so TypeScript callers can import it.

export type RowKey = 'idea' | 'design' | 'demo' | 'live' | 'access' | 'pay' | 'name' | 'cost';
export type RowStatus = 'done' | 'now' | 'redo' | 'skip' | 'todo';
export type Mode = 'talk' | 'work' | 'you' | 'warn' | 'fin';

export interface RoomRecord {
  room_nanoid?: unknown;
  title?: unknown;
  is_default?: unknown;
  created_time_stamp?: unknown;
}

export interface SavedMessage {
  sequence?: unknown;
  sender_agent_id?: unknown;
  text?: unknown;
}

export interface Row {
  status: RowStatus;
  address?: string;
}

export interface Button {
  row: RowKey;
  label: string;
  address: string;
  primary: boolean;
}

export interface Progress {
  appName: string | undefined;
  rows: Record<RowKey, Row>;
  nextRow: RowKey | undefined;
  mode: Mode;
  moment: string;
  next: string | undefined;
  step: number;
  total: number;
  percent: number;
  buttons: Button[];
}

export const ROWS: RowKey[];
export const STAGE_ROWS: RowKey[];
export const AFTER_ROWS: RowKey[];
export function appRoom(rooms: unknown): (RoomRecord & { room_nanoid: string }) | undefined;
export function openableAddress(value: unknown): string | undefined;
export function isLocalAddress(address: string): boolean;
export function deriveProgress(input: {
  room: RoomRecord | undefined;
  agents: Record<string, string> | undefined;
  messages: SavedMessage[];
}): Progress;

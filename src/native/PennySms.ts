/**
 * Typed wrapper over the `PennySms` TurboModule. Converts inbox rows into the
 * core `RawSms` contract and provides a paged inbox iterator.
 */
import type { EventSubscription } from 'react-native';
import type { EpochMs, RawSms } from '../core/types';
import NativePennySms, { type SmsPermissionState } from './NativePennySms';

export type { SmsPermissionState };

export const INBOX_PAGE_SIZE = 500;

export function checkSmsPermission(): Promise<SmsPermissionState> {
  return NativePennySms.checkPermission();
}

export function requestSmsPermission(): Promise<SmsPermissionState> {
  return NativePennySms.requestPermission();
}

export function hasSmsAccess(state: SmsPermissionState): boolean {
  return state.read;
}

export function openAppSettings(): void {
  NativePennySms.openAppSettings();
}

export function getMaxSmsId(): Promise<string> {
  return NativePennySms.getMaxId();
}

export function secureRandomHex(byteCount: number): Promise<string> {
  return NativePennySms.secureRandomHex(byteCount);
}

export async function queryInbox(afterId: string, sinceMs: EpochMs, limit = INBOX_PAGE_SIZE): Promise<RawSms[]> {
  const rows = await NativePennySms.queryInbox(afterId, sinceMs, limit);
  return rows.map(r => ({ id: r.id, address: r.address, body: r.body, date: r.date }));
}

/** Pages through the inbox (`_id > afterId`, `date >= sinceMs`) in ascending id order. */
export async function* inboxPages(
  afterId: string,
  sinceMs: EpochMs,
  limit = INBOX_PAGE_SIZE,
): AsyncGenerator<RawSms[], void, void> {
  let cursor = afterId;
  for (;;) {
    const page = await queryInbox(cursor, sinceMs, limit);
    if (page.length === 0) {
      return;
    }
    yield page;
    cursor = page[page.length - 1].id;
    if (page.length < limit) {
      return;
    }
  }
}

/** Subscribes to the live "an SMS just arrived" signal (only while JS is alive). */
export function onSmsReceived(cb: (receivedAt: EpochMs) => void): EventSubscription {
  return NativePennySms.onSmsReceived(cb);
}

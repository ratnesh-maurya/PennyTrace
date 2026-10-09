import { sha256 } from '@noble/hashes/sha2.js';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js';

/** `AX-HDFCBK-S` / `VM-HDFCBK` / `HDFCBK` → `HDFCBK`. */
export function normalizeSender(sender: string): string {
  const upper = sender.trim().toUpperCase();
  const parts = upper.split('-');
  if (parts.length >= 2 && /^[A-Z]{2}$/.test(parts[0])) {
    return parts[1];
  }
  return upper.replace(/^\+?91(?=\d{10}$)/, '');
}

export function normalizeBody(body: string): string {
  return body.replace(/\s+/g, ' ').trim();
}

/**
 * Identity of one message. The same SMS seen by the live receiver and by an
 * inbox rescan (or delivered twice by the carrier) yields the same fingerprint.
 * Timestamps are deliberately excluded: receiver and provider report different ones.
 */
export function fingerprint(sender: string, body: string): string {
  return bytesToHex(sha256(utf8ToBytes(`${normalizeSender(sender)}|${normalizeBody(body)}`)));
}

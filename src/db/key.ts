/**
 * SQLCipher key bootstrap.
 *
 * A random 256-bit key is generated once (java.security.SecureRandom via the
 * PennySms module, since Hermes has no crypto.getRandomValues) and stored with
 * react-native-keychain as an AES-GCM blob whose wrapping key lives in the
 * Android Keystore. AES_GCM_NO_AUTH: no biometric prompt, so the headless
 * background scan can open the DB while the app is closed.
 */
import * as Keychain from 'react-native-keychain';
import { secureRandomHex } from '../native/PennySms';

const SERVICE = 'pennytrace.db';
const USERNAME = 'sqlcipher';
const KEY_BYTES = 32;

let pending: Promise<string> | null = null;

function isHexKey(s: string): boolean {
  return s.length === KEY_BYTES * 2 && /^[0-9a-f]+$/.test(s);
}

async function loadOrCreate(): Promise<string> {
  const existing = await Keychain.getGenericPassword({ service: SERVICE });
  if (existing && isHexKey(existing.password)) {
    return existing.password;
  }
  const hex = (await secureRandomHex(KEY_BYTES)).toLowerCase();
  if (!isHexKey(hex)) {
    throw new Error('secureRandomHex returned an invalid key');
  }
  const ok = await Keychain.setGenericPassword(USERNAME, hex, {
    service: SERVICE,
    storage: Keychain.STORAGE_TYPE.AES_GCM_NO_AUTH,
    securityLevel: Keychain.SECURITY_LEVEL.SECURE_SOFTWARE,
  });
  if (!ok) {
    throw new Error('Could not store the database key in the Android Keystore');
  }
  return hex;
}

/** Hex-encoded 32-byte key. Single-flight so concurrent callers never mint two keys. */
export function getOrCreateDbKey(): Promise<string> {
  if (!pending) {
    pending = loadOrCreate().catch(e => {
      pending = null;
      throw e;
    });
  }
  return pending;
}

/**
 * SQLCipher raw-key syntax: `x'<64 hex>'` skips PBKDF2 (the key is already
 * full-entropy), which keeps cold opens in the headless task fast.
 */
export function toSqlcipherRawKey(hex: string): string {
  return `x'${hex}'`;
}

/** Forgets the key (used together with deleting the DB file for "Delete all data"). */
export async function deleteDbKey(): Promise<void> {
  pending = null;
  await Keychain.resetGenericPassword({ service: SERVICE });
}

/**
 * Codegen spec for the `PennySms` TurboModule (Kotlin: com.pennytrace.sms.PennySmsModule).
 *
 * Platform I/O only: reading the SMS inbox, permission prompts, and a wake-up
 * event when a new SMS arrives. No parsing happens natively.
 *
 * Use the typed wrapper in `./PennySms` rather than importing this directly.
 */
import type { CodegenTypes, TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

export type SmsPermissionState = {
  read: boolean;
  receive: boolean;
};

export type InboxSms = {
  /** Telephony `_id`, stringified. */
  id: string;
  address: string;
  body: string;
  /** Delivery time, epoch ms. */
  date: number;
};

export interface Spec extends TurboModule {
  checkPermission(): Promise<SmsPermissionState>;
  /** Prompts for READ_SMS + RECEIVE_SMS. Resolves with the resulting state. */
  requestPermission(): Promise<SmsPermissionState>;
  /**
   * Inbox rows with `_id > afterId AND date >= sinceMs`, ascending by `_id`,
   * at most `limit` rows. Page by passing the last returned id as `afterId`.
   */
  queryInbox(afterId: string, sinceMs: number, limit: number): Promise<InboxSms[]>;
  /** Highest inbox `_id`, or "0" when the inbox is empty / unreadable. */
  getMaxId(): Promise<string>;
  openAppSettings(): void;
  /** Hex string of `byteCount` bytes from java.security.SecureRandom (Hermes has no crypto.getRandomValues). */
  secureRandomHex(byteCount: number): Promise<string>;
  /**
   * Fires (with the receive time, epoch ms) when an SMS arrives while the JS
   * runtime is alive. Carries no message content: JS rescans the inbox.
   */
  readonly onSmsReceived: CodegenTypes.EventEmitter<number>;
}

export default TurboModuleRegistry.getEnforcing<Spec>('PennySms');

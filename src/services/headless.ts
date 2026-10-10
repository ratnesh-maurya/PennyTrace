/**
 * Wiring between Android wake-ups and the sync service.
 *
 * Background: android ScanWorker (WorkManager, after SMS_RECEIVED / boot) runs
 * the headless JS task `PennySmsScan` in the app's React runtime, starting it
 * if needed. Foreground: the native `onSmsReceived` event and AppState
 * 'active' trigger a scan directly. Scans are single-flight, so overlapping
 * triggers coalesce.
 */
import { AppRegistry, AppState } from 'react-native';
import { onSmsReceived } from '../native/PennySms';
import { runIncrementalScan } from './sync';

/** Must match SCAN_TASK_KEY in android/.../sms/ScanWorker.kt. */
export const SCAN_TASK_KEY = 'PennySmsScan';

/** The default SMS app writes the message into the provider just after the broadcast. */
const SMS_SETTLE_MS = 3_000;

function scanQuietly(reason: string): Promise<void> {
  return runIncrementalScan({ reason }).then(
    () => undefined,
    () => undefined, // Errors are surfaced through onSyncProgress ('error'); never crash the task.
  );
}

let registered = false;

/** Call once at startup (index.js), before AppRegistry.registerComponent. */
export function registerSyncTasks(): void {
  if (registered) {
    return;
  }
  registered = true;

  AppRegistry.registerHeadlessTask(SCAN_TASK_KEY, () => async (data?: { reason?: string }) => {
    await scanQuietly(data?.reason ?? 'headless');
  });

  let smsTimer: ReturnType<typeof setTimeout> | null = null;
  onSmsReceived(() => {
    if (smsTimer) {
      clearTimeout(smsTimer);
    }
    smsTimer = setTimeout(() => {
      smsTimer = null;
      scanQuietly('sms');
    }, SMS_SETTLE_MS);
  });

  let lastState: string | null | undefined = AppState.currentState;
  AppState.addEventListener('change', next => {
    if (next === 'active' && lastState !== 'active') {
      scanQuietly('foreground');
    }
    lastState = next;
  });
  if (AppState.currentState === 'active') {
    scanQuietly('launch');
  }
}

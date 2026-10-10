package com.pennytrace.sms

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.provider.Telephony

/**
 * Wakes the app when an SMS arrives. It never reads or parses the message: the inbox is the
 * source of truth and JS rescans it (`_id > last_scanned_sms_id`).
 *
 * Declared with `android:permission="android.permission.BROADCAST_SMS"` so only the telephony
 * stack can deliver to it.
 */
class SmsReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    if (intent.action != Telephony.Sms.Intents.SMS_RECEIVED_ACTION) return
    val emitted = PennySmsModule.emitIfAlive(System.currentTimeMillis())
    // Live JS handles foreground arrivals. When nobody is listening, or the app is not in the
    // foreground (its process may be frozen before JS gets to run), schedule a headless scan too;
    // scans are single-flight and idempotent.
    if (!emitted || !PennySmsModule.isForeground()) {
      ScanScheduler.enqueue(context, reason = "sms")
    }
  }
}

/** Schedules a catch-up scan after reboot or app update, in case broadcasts were missed. */
class BootReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent) {
    when (intent.action) {
      Intent.ACTION_BOOT_COMPLETED,
      Intent.ACTION_MY_PACKAGE_REPLACED -> ScanScheduler.enqueue(context, reason = "boot", delayMs = 30_000L)
    }
  }
}

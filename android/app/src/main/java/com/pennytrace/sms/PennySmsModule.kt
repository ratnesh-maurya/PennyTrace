package com.pennytrace.sms

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.provider.Settings
import android.provider.Telephony
import androidx.core.content.ContextCompat
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.WritableMap
import com.facebook.react.common.LifecycleState
import com.facebook.react.module.annotations.ReactModule
import com.facebook.react.modules.core.PermissionAwareActivity
import com.facebook.react.modules.core.PermissionListener
import com.pennytrace.specs.NativePennySmsSpec
import java.lang.ref.WeakReference
import java.security.SecureRandom
import java.util.concurrent.Executors

/**
 * Platform I/O for SMS: permission prompts, inbox reads, and a wake-up event.
 * It never parses message content; all parsing is in TypeScript (src/core).
 */
@ReactModule(name = PennySmsModule.NAME)
class PennySmsModule(reactContext: ReactApplicationContext) : NativePennySmsSpec(reactContext) {

  override fun getName(): String = NAME

  init {
    live = WeakReference(this)
  }

  override fun invalidate() {
    if (live?.get() === this) live = null
    super.invalidate()
  }

  // --- permissions ---------------------------------------------------------------------------

  private fun granted(permission: String): Boolean =
      ContextCompat.checkSelfPermission(reactApplicationContext, permission) ==
          PackageManager.PERMISSION_GRANTED

  private fun permissionState(): WritableMap =
      Arguments.createMap().apply {
        putBoolean("read", granted(Manifest.permission.READ_SMS))
        putBoolean("receive", granted(Manifest.permission.RECEIVE_SMS))
      }

  override fun checkPermission(promise: Promise) {
    promise.resolve(permissionState())
  }

  override fun requestPermission(promise: Promise) {
    if (granted(Manifest.permission.READ_SMS) && granted(Manifest.permission.RECEIVE_SMS)) {
      promise.resolve(permissionState())
      return
    }
    val activity = reactApplicationContext.currentActivity as? PermissionAwareActivity
    if (activity == null) {
      promise.reject("E_NO_ACTIVITY", "Cannot request SMS permission without a foreground activity")
      return
    }
    val listener = PermissionListener { requestCode, _, _ ->
      if (requestCode != REQUEST_CODE) return@PermissionListener false
      promise.resolve(permissionState())
      true
    }
    activity.requestPermissions(
        arrayOf(Manifest.permission.READ_SMS, Manifest.permission.RECEIVE_SMS),
        REQUEST_CODE,
        listener,
    )
  }

  override fun openAppSettings() {
    val intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
            .setData(Uri.fromParts("package", reactApplicationContext.packageName, null))
            .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    reactApplicationContext.startActivity(intent)
  }

  // --- inbox ---------------------------------------------------------------------------------

  override fun queryInbox(afterId: String, sinceMs: Double, limit: Double, promise: Promise) {
    val after = afterId.toLongOrNull()
    if (after == null || after < 0) {
      promise.reject("E_BAD_CURSOR", "afterId must be a non-negative integer string")
      return
    }
    if (!granted(Manifest.permission.READ_SMS)) {
      promise.reject("E_PERMISSION", "READ_SMS not granted")
      return
    }
    val since = sinceMs.toLong().coerceAtLeast(0L)
    val max = limit.toInt().coerceIn(1, MAX_PAGE)
    io.execute {
      try {
        val rows = Arguments.createArray()
        val resolver = reactApplicationContext.contentResolver
        // Values are validated longs, so inlining them is injection-safe and avoids
        // TEXT-vs-INTEGER affinity surprises in selectionArgs.
        val selection = "${Telephony.Sms._ID} > $after AND ${Telephony.Sms.DATE} >= $since"
        // "LIMIT" in sortOrder is honoured by AOSP SmsProvider; the loop also caps rows in case an
        // OEM provider ignores it.
        val order = "${Telephony.Sms._ID} ASC LIMIT $max"
        resolver
            .query(Telephony.Sms.Inbox.CONTENT_URI, PROJECTION, selection, null, order)
            ?.use { c ->
              val iId = c.getColumnIndexOrThrow(Telephony.Sms._ID)
              val iAddr = c.getColumnIndexOrThrow(Telephony.Sms.ADDRESS)
              val iBody = c.getColumnIndexOrThrow(Telephony.Sms.BODY)
              val iDate = c.getColumnIndexOrThrow(Telephony.Sms.DATE)
              var n = 0
              while (n < max && c.moveToNext()) {
                rows.pushMap(
                    Arguments.createMap().apply {
                      putString("id", c.getLong(iId).toString())
                      putString("address", c.getString(iAddr) ?: "")
                      putString("body", c.getString(iBody) ?: "")
                      putDouble("date", c.getLong(iDate).toDouble())
                    })
                n++
              }
            }
        promise.resolve(rows)
      } catch (e: SecurityException) {
        promise.reject("E_PERMISSION", e.message, e)
      } catch (e: Exception) {
        promise.reject("E_QUERY", e.message, e)
      }
    }
  }

  override fun getMaxId(promise: Promise) {
    if (!granted(Manifest.permission.READ_SMS)) {
      promise.resolve("0")
      return
    }
    io.execute {
      try {
        val id =
            reactApplicationContext.contentResolver
                .query(
                    Telephony.Sms.Inbox.CONTENT_URI,
                    arrayOf(Telephony.Sms._ID),
                    null,
                    null,
                    "${Telephony.Sms._ID} DESC LIMIT 1",
                )
                ?.use { c -> if (c.moveToFirst()) c.getLong(0) else 0L } ?: 0L
        promise.resolve(id.toString())
      } catch (e: Exception) {
        promise.reject("E_QUERY", e.message, e)
      }
    }
  }

  override fun secureRandomHex(byteCount: Double, promise: Promise) {
    val n = byteCount.toInt()
    if (n !in 1..1024) {
      promise.reject("E_RANGE", "byteCount must be 1..1024")
      return
    }
    val bytes = ByteArray(n)
    SecureRandom().nextBytes(bytes)
    promise.resolve(bytes.joinToString("") { "%02x".format(it.toInt() and 0xff) })
  }

  // --- events --------------------------------------------------------------------------------

  /** True when JS has instantiated this module and can receive `onSmsReceived`. */
  private fun canEmit(): Boolean = mEventEmitterCallback != null && reactApplicationContext.hasActiveReactInstance()

  private fun emitSmsReceived(receivedAt: Long): Boolean {
    if (!canEmit()) return false
    return try {
      emitOnSmsReceived(receivedAt.toDouble())
      true
    } catch (_: Exception) {
      false
    }
  }

  companion object {
    const val NAME = NativePennySmsSpec.NAME
    private const val REQUEST_CODE = 0x5353 // "SS"
    private const val MAX_PAGE = 2000
    private val PROJECTION =
        arrayOf(Telephony.Sms._ID, Telephony.Sms.ADDRESS, Telephony.Sms.BODY, Telephony.Sms.DATE)

    /** Single background thread: inbox reads are serial and never touch the JS/UI threads. */
    private val io = Executors.newSingleThreadExecutor { r -> Thread(r, "PennySms-io").apply { isDaemon = true } }

    @Volatile private var live: WeakReference<PennySmsModule>? = null

    /**
     * Emits `onSmsReceived` if a JS runtime with this module is alive.
     * @return false when nobody is listening, so the caller should schedule a headless scan.
     */
    /** True when the live React context has a resumed activity. */
    @JvmStatic
    fun isForeground(): Boolean =
        live?.get()?.reactApplicationContext?.lifecycleState == LifecycleState.RESUMED

    @JvmStatic
    fun emitIfAlive(receivedAt: Long): Boolean {
      val module = live?.get() ?: return false
      return module.emitSmsReceived(receivedAt)
    }
  }
}

package com.pennytrace.sms

import android.content.Context
import android.os.Handler
import android.os.Looper
import android.util.Log
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import androidx.work.workDataOf
import com.facebook.react.ReactApplication
import com.facebook.react.ReactInstanceEventListener
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.ReactContext
import com.facebook.react.jstasks.HeadlessJsTaskConfig
import com.facebook.react.jstasks.HeadlessJsTaskContext
import com.facebook.react.jstasks.HeadlessJsTaskEventListener
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/** Name of the JS task registered in src/services/headless.ts. */
const val SCAN_TASK_KEY = "PennySmsScan"

/** Enqueues the background inbox scan. The inbox is the durable queue, so a scan is always safe. */
object ScanScheduler {
  private const val UNIQUE_NAME = "pennytrace-sms-scan"

  fun enqueue(context: Context, reason: String, delayMs: Long = 3_000L) {
    val request =
        OneTimeWorkRequestBuilder<ScanWorker>()
            // The default SMS app writes the message into the provider shortly after
            // SMS_RECEIVED; scanning immediately could miss it.
            .setInitialDelay(delayMs, TimeUnit.MILLISECONDS)
            .setInputData(workDataOf(ScanWorker.KEY_REASON to reason))
            .build()
    // KEEP: a pending/running scan already covers this SMS. JS also re-runs a scan that was
    // requested while one was in flight (single-flight + rerun flag in src/services/sync.ts).
    WorkManager.getInstance(context.applicationContext)
        .enqueueUniqueWork(UNIQUE_NAME, ExistingWorkPolicy.KEEP, request)
  }
}

/**
 * Runs the `PennySmsScan` headless JS task and waits for it to finish.
 *
 * The task is hosted directly by this worker through [HeadlessJsTaskContext] (the same mechanism
 * `HeadlessJsTaskService` uses internally) instead of starting a `HeadlessJsTaskService`: since
 * Android 8 a background app may not call `startService()` from a JobScheduler/WorkManager job,
 * whereas a worker can run for up to 10 minutes and WorkManager holds a wake lock for it.
 */
class ScanWorker(context: Context, params: WorkerParameters) : Worker(context, params) {

  override fun doWork(): Result {
    val app = applicationContext as? ReactApplication ?: return Result.failure()
    val reason = inputData.getString(KEY_REASON) ?: "worker"
    val done = CountDownLatch(1)
    Handler(Looper.getMainLooper()).post {
      try {
        startTask(app, reason) { done.countDown() }
      } catch (e: Exception) {
        Log.w(TAG, "scan task failed to start", e)
        done.countDown()
      }
    }
    done.await(TASK_TIMEOUT_MS + 30_000L, TimeUnit.MILLISECONDS)
    return Result.success()
  }

  /** Must run on the main thread. */
  private fun startTask(app: ReactApplication, reason: String, onFinish: () -> Unit) {
    val host = app.reactHost ?: error("ReactHost not initialised")
    val current = host.currentReactContext
    if (current != null) {
      invoke(current, reason, onFinish)
      return
    }
    host.addReactInstanceEventListener(
        object : ReactInstanceEventListener {
          override fun onReactContextInitialized(context: ReactContext) {
            host.removeReactInstanceEventListener(this)
            Handler(Looper.getMainLooper()).post {
              try {
                invoke(context, reason, onFinish)
              } catch (e: Exception) {
                Log.w(TAG, "scan task failed to start", e)
                onFinish()
              }
            }
          }
        })
    host.start()
  }

  private fun invoke(context: ReactContext, reason: String, onFinish: () -> Unit) {
    val tasks = HeadlessJsTaskContext.getInstance(context)
    var taskId = -1
    tasks.addTaskEventListener(
        object : HeadlessJsTaskEventListener {
          override fun onHeadlessJsTaskStart(taskId: Int) = Unit

          override fun onHeadlessJsTaskFinish(finishedId: Int) {
            if (finishedId != taskId) return
            tasks.removeTaskEventListener(this)
            onFinish()
          }
        })
    val data = Arguments.createMap().apply { putString("reason", reason) }
    taskId =
        tasks.startTask(
            HeadlessJsTaskConfig(
                SCAN_TASK_KEY,
                data,
                TASK_TIMEOUT_MS,
                // The app may be open (RESUMED); JS single-flights scans, so this is safe.
                true,
            ))
  }

  companion object {
    const val KEY_REASON = "reason"
    private const val TAG = "PennyScanWorker"
    private const val TASK_TIMEOUT_MS = 5 * 60_000L
  }
}

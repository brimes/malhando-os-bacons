package com.mob.watch

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import android.util.Log
import kotlinx.coroutines.*

/**
 * Foreground service that periodically syncs health data (steps, heart rate)
 * with the MOB backend. Runs every 30 minutes while the watch is active.
 */
class SyncService : Service() {

    companion object {
        private const val TAG = "MOBSyncService"
        private const val CHANNEL_ID = "mob_sync"
        private const val NOTIFICATION_ID = 1001
        private const val SYNC_INTERVAL_MS = 30 * 60 * 1000L // 30 minutes

        fun start(context: Context) {
            val intent = Intent(context, SyncService::class.java)
            context.startForegroundService(intent)
        }

        fun stop(context: Context) {
            context.stopService(Intent(context, SyncService::class.java))
        }
    }

    private val serviceScope = CoroutineScope(Dispatchers.IO + SupervisorJob())
    private lateinit var apiClient: ApiClient
    private lateinit var healthCollector: HealthDataCollector

    override fun onCreate() {
        super.onCreate()
        apiClient = ApiClient(this)
        healthCollector = HealthDataCollector(this)
        createNotificationChannel()
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        startForeground(NOTIFICATION_ID, buildNotification())
        startSyncLoop()
        return START_STICKY // Restart if killed
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onDestroy() {
        super.onDestroy()
        serviceScope.cancel()
    }

    private fun startSyncLoop() {
        serviceScope.launch {
            while (isActive) {
                try {
                    syncNow()
                } catch (e: Exception) {
                    Log.e(TAG, "Sync error: ${e.message}", e)
                }
                delay(SYNC_INTERVAL_MS)
            }
        }
    }

    /**
     * Perform a single sync: read steps and upload to backend
     */
    suspend fun syncNow() {
        if (!apiClient.isLoggedIn()) {
            Log.d(TAG, "Skipping sync: not logged in")
            return
        }

        val steps = healthCollector.getCurrentSteps()
        val calories = healthCollector.estimateCaloriesFromSteps(steps)
        val today = healthCollector.todayDate()

        Log.i(TAG, "Syncing: $steps steps, ${calories.toInt()} calories for $today")

        val result = apiClient.syncSteps(today, steps, calories)
        result.onSuccess {
            Log.i(TAG, "Sync successful")
        }.onFailure { e ->
            Log.e(TAG, "Sync failed: ${e.message}")
        }
    }

    private fun createNotificationChannel() {
        val channel = NotificationChannel(
            CHANNEL_ID,
            "MOB Sync",
            NotificationManager.IMPORTANCE_LOW
        ).apply {
            description = "Sincronização em background com o MOB"
            setShowBadge(false)
        }
        val manager = getSystemService(NotificationManager::class.java)
        manager.createNotificationChannel(channel)
    }

    private fun buildNotification(): Notification {
        return Notification.Builder(this, CHANNEL_ID)
            .setContentTitle("MOB")
            .setContentText("Sincronizando dados de saúde...")
            .setSmallIcon(android.R.drawable.ic_popup_sync)
            .setOngoing(true)
            .build()
    }
}

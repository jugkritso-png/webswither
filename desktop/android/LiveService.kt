// ใส่ลงโปรเจกต์ Android โดย desktop/android/prepare.sh (แทน __PACKAGE__ ด้วย package ของแอป)
//
// บริการเบื้องหน้าระหว่างไลฟ์/บันทึก: แจ้งเตือน "กำลังไลฟ์" ค้างไว้ ทำให้ Android ไม่หยุดกล้อง ไมค์ และการสตรีม
// เมื่อผู้ใช้ปิดจอหรือสลับไปแอปอื่น · ถือ wake lock (CPU) และ Wi-Fi lock ไว้ตลอดช่วงไลฟ์
// แอปเรียก start/stop ผ่าน JNI (คำสั่ง set_live ใน desktop/src-tauri/src/lib.rs)
package __PACKAGE__

import android.Manifest
import android.app.Activity
import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ServiceInfo
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import android.util.Log

class LiveService : Service() {
    private var wake: PowerManager.WakeLock? = null
    private var wifi: WifiManager.WifiLock? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val text = intent?.getStringExtra("text") ?: "กำลังไลฟ์"
        val nm = getSystemService(NotificationManager::class.java)
        if (Build.VERSION.SDK_INT >= 26) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "ไลฟ์และบันทึก", NotificationManager.IMPORTANCE_LOW))
        }
        val open = PendingIntent.getActivity(
            this, 0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        // "หยุดไลฟ์…" เปิดหน้ายืนยันในแอป (กดค้างเพื่อหยุด) — ไม่หยุดทันที กันมือโดนตอนมือถืออยู่ในกระเป๋า
        val stop = PendingIntent.getActivity(
            this, 1,
            Intent(this, MainActivity::class.java).setAction(ACTION_STOP).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT
        )
        if (startedAt == 0L) startedAt = System.currentTimeMillis()
        @Suppress("DEPRECATION")
        val builder = if (Build.VERSION.SDK_INT >= 26) Notification.Builder(this, CHANNEL) else Notification.Builder(this)
        val notification = builder
            .setContentTitle(text)
            .setContentText("แตะเพื่อกลับไปที่แอป")
            .setSmallIcon(applicationInfo.icon)
            .setOngoing(true)
            .setWhen(startedAt)
            .setShowWhen(true)
            .setUsesChronometer(true)
            .setContentIntent(open)
            .addAction(Notification.Action.Builder(
                android.graphics.drawable.Icon.createWithResource(this, android.R.drawable.ic_menu_close_clear_cancel),
                "หยุดไลฟ์…", stop
            ).build())
            .build()
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(NOTIFICATION_ID, notification, types())
            else startForeground(NOTIFICATION_ID, notification)
        } catch (e: Exception) {
            Log.w("WebMix", "LiveService startForeground: $e")
            stopSelf()
            return START_NOT_STICKY
        }
        if (wake == null) {
            wake = getSystemService(PowerManager::class.java)
                .newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "webmix:live").also { it.acquire() }
        }
        if (wifi == null) {
            @Suppress("DEPRECATION")
            wifi = (applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager)
                .createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "webmix:live").also { it.acquire() }
        }
        running = true
        Log.i("WebMix", "LiveService started: $text")
        return START_NOT_STICKY
    }

    // Android 14: ชนิดของบริการต้องตรงกับสิทธิ์ที่ได้รับแล้ว (กล้อง/ไมค์) — mediaPlayback ใส่ไว้เสมอ (ไม่ต้องขอสิทธิ์)
    @androidx.annotation.RequiresApi(29)
    private fun types(): Int {
        var t = ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK
        if (Build.VERSION.SDK_INT >= 30) {
            if (granted(Manifest.permission.CAMERA)) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_CAMERA
            if (granted(Manifest.permission.RECORD_AUDIO)) t = t or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
        }
        return t
    }

    private fun granted(p: String) = checkSelfPermission(p) == PackageManager.PERMISSION_GRANTED

    override fun onDestroy() {
        running = false
        startedAt = 0L
        wake?.let { if (it.isHeld) it.release() }
        wifi?.let { if (it.isHeld) it.release() }
        wake = null
        wifi = null
        Log.i("WebMix", "LiveService stopped")
        super.onDestroy()
    }

    companion object {
        private const val CHANNEL = "webmix-live"
        private const val NOTIFICATION_ID = 4401
        const val ACTION_STOP = "io.github.webmix.STOP_LIVE"
        private var startedAt = 0L

        @Volatile
        @JvmStatic
        var running = false

        @JvmStatic
        fun start(activity: Activity, text: String) {
            // Android 13+: ขอสิทธิ์แสดงแจ้งเตือน (ถ้าไม่ให้ บริการยังทำงาน แต่ไม่เห็นแจ้งเตือน)
            if (Build.VERSION.SDK_INT >= 33 &&
                activity.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED
            ) {
                activity.requestPermissions(arrayOf(Manifest.permission.POST_NOTIFICATIONS), NOTIFICATION_ID)
            }
            running = true
            val intent = Intent(activity, LiveService::class.java).putExtra("text", text)
            if (Build.VERSION.SDK_INT >= 26) activity.startForegroundService(intent) else activity.startService(intent)
        }

        @JvmStatic
        fun stop(activity: Activity) {
            running = false
            activity.stopService(Intent(activity, LiveService::class.java))
        }
    }
}

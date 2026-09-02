package com.minio.mobile.util

import android.app.NotificationChannel
import android.app.NotificationManager
import android.content.Context
import android.os.Build
import androidx.core.app.NotificationCompat

class TaskNotificationManager(private val context: Context) {
    private val channelId = "mini_o_task_channel"
    private val notificationManager =
        context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

    init {
        createNotificationChannel()
    }

    private fun createNotificationChannel() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val channel = NotificationChannel(
                channelId,
                "Mini-O Workspace Tasks",
                NotificationManager.IMPORTANCE_DEFAULT
            ).apply {
                description = "Notifications for background AI tasks and chat responses"
            }
            notificationManager.createNotificationChannel(channel)
        }
    }

    fun showTaskCompleteNotification(title: String, message: String) {
        val notification = NotificationCompat.Builder(context, channelId)
            .setSmallIcon(android.R.drawable.stat_sys_download_done)
            .setContentTitle(title)
            .setContentText(message)
            .setPriority(NotificationCompat.PRIORITY_DEFAULT)
            .setAutoCancel(true)
            .build()

        notificationManager.notify(System.currentTimeMillis().toInt(), notification)
    }
}

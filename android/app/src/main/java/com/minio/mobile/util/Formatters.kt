package com.minio.mobile.util

import java.text.DecimalFormat
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

object Formatters {
    fun formatFileSize(size: Long?): String {
        if (size == null || size <= 0) return "--"
        val units = arrayOf("B", "KB", "MB", "GB", "TB")
        val digitGroups = (Math.log10(size.toDouble()) / Math.log10(1024.0)).toInt()
        val num = size / Math.pow(1024.0, digitGroups.toDouble())
        val df = DecimalFormat("#,##0.#")
        return "${df.format(num)} ${units[digitGroups.coerceIn(0, units.size - 1)]}"
    }

    fun formatTimestamp(epochSeconds: Double?): String {
        if (epochSeconds == null || epochSeconds <= 0) return "--"
        val date = Date((epochSeconds * 1000).toLong())
        val sdf = SimpleDateFormat("MMM d, yyyy HH:mm", Locale.getDefault())
        return sdf.format(date)
    }

    fun formatMillis(millis: Long): String {
        if (millis <= 0) return "--"
        val date = Date(millis)
        val sdf = SimpleDateFormat("MMM d, HH:mm:ss", Locale.getDefault())
        return sdf.format(date)
    }

    fun redactToken(token: String): String {
        if (token.length <= 6) return "***"
        return "${token.take(3)}...${token.takeLast(3)}"
    }

    fun sanitizeMath(input: String): String {
        // Strip or escape unsupported math tokens cleanly if needed
        return input.replace(Regex("\\$\\\$"), "$")
    }

    fun sanitizePath(path: String): String {
        require(!path.contains("..")) { "Path traversal not allowed: $path" }
        return path.trim().removePrefix("/")
    }
}

package com.minio.mobile.util

import com.minio.mobile.data.ConnectionProfile
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

@Serializable
data class QrPairingPayload(
    val url: String,
    val token: String = "",
    val name: String = "Mini-O Desktop"
)

object QrPairingHelper {
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }

    fun generatePairingJson(url: String, token: String, name: String): String {
        val payload = QrPairingPayload(url.trim(), token.trim(), name.trim())
        return json.encodeToString(payload)
    }

    fun parsePairingPayload(qrText: String): ConnectionProfile? {
        val raw = qrText.trim()
        // Format 1: JSON payload
        runCatching {
            val payload = json.decodeFromString<QrPairingPayload>(raw)
            if (payload.url.startsWith("http://") || payload.url.startsWith("https://")) {
                return ConnectionProfile(name = payload.name, url = payload.url, token = payload.token)
            }
        }

        // Format 2: Raw URL string
        if (raw.startsWith("http://") || raw.startsWith("https://")) {
            return ConnectionProfile(name = "Discovered Mini-O", url = raw, token = "")
        }

        return null
    }
}

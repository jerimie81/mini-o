package com.minio.mobile.data

import android.content.Context
import android.content.SharedPreferences
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

class ConnectionStore(context: Context) {
    private val json = Json { ignoreUnknownKeys = true }
    private val prefs: SharedPreferences? = runCatching {
        val masterKey = MasterKey.Builder(context)
            .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
            .build()
        EncryptedSharedPreferences.create(
            context,
            "mini_o_secure_store",
            masterKey,
            EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
            EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
        )
    }.getOrNull() ?: context.getSharedPreferences("mini_o_fallback_store", Context.MODE_PRIVATE)

    fun saveProfiles(profiles: List<ConnectionProfile>) {
        val raw = json.encodeToString(profiles)
        prefs?.edit()?.putString("profiles", raw)?.apply()
    }

    fun getProfiles(): List<ConnectionProfile> {
        val raw = prefs?.getString("profiles", null) ?: return emptyList()
        return runCatching { json.decodeFromString<List<ConnectionProfile>>(raw) }.getOrDefault(emptyList())
    }

    fun saveActiveProfileId(id: String?) {
        prefs?.edit()?.putString("active_profile_id", id)?.apply()
    }

    fun getActiveProfileId(): String? = prefs?.getString("active_profile_id", null)

    fun saveLastConnectionTime(timestamp: Long) {
        prefs?.edit()?.putLong("last_connection_time", timestamp)?.apply()
    }

    fun getLastConnectionTime(): Long = prefs?.getLong("last_connection_time", 0L) ?: 0L

    fun saveSelectedModel(model: String) {
        prefs?.edit()?.putString("selected_model", model)?.apply()
    }

    fun getSelectedModel(): String? = prefs?.getString("selected_model", null)

    fun saveThemePreference(theme: String) { // "SYSTEM", "LIGHT", "DARK"
        prefs?.edit()?.putString("theme_mode", theme)?.apply()
    }

    fun getThemePreference(): String = prefs?.getString("theme_mode", "SYSTEM") ?: "SYSTEM"

    fun saveTimeoutSeconds(connect: Int, read: Int) {
        prefs?.edit()?.putInt("timeout_connect", connect)?.putInt("timeout_read", read)?.apply()
    }

    fun getConnectTimeout(): Int = prefs?.getInt("timeout_connect", 10) ?: 10
    fun getReadTimeout(): Int = prefs?.getInt("timeout_read", 60) ?: 60

    fun saveVoiceDisabled(disabled: Boolean) {
        prefs?.edit()?.putBoolean("voice_disabled", disabled)?.apply()
    }

    fun isVoiceDisabled(): Boolean = prefs?.getBoolean("voice_disabled", false) ?: false

    fun saveVoiceLanguage(langCode: String) {
        prefs?.edit()?.putString("voice_lang", langCode)?.apply()
    }

    fun getVoiceLanguage(): String = prefs?.getString("voice_lang", "default") ?: "default"

    fun clearAllData() {
        prefs?.edit()?.clear()?.apply()
    }
}

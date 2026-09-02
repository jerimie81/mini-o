package com.minio.mobile.data

import android.content.Context
import kotlinx.serialization.Serializable
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.json.Json

@Serializable
data class ConversationThread(
    val id: String = java.util.UUID.randomUUID().toString(),
    val title: String = "New Conversation",
    val createdAt: Long = System.currentTimeMillis(),
    val updatedAt: Long = System.currentTimeMillis(),
    val messages: List<ChatMessage> = emptyList()
)

class ChatStorage(context: Context) {
    private val prefs = context.getSharedPreferences("mini_o_chat_store", Context.MODE_PRIVATE)
    private val json = Json { ignoreUnknownKeys = true }

    fun saveThreads(threads: List<ConversationThread>) {
        val raw = json.encodeToString(threads)
        prefs.edit().putString("chat_threads", raw).apply()
    }

    fun getThreads(): List<ConversationThread> {
        val raw = prefs.getString("chat_threads", null) ?: return emptyList()
        return runCatching { json.decodeFromString<List<ConversationThread>>(raw) }.getOrDefault(emptyList())
    }

    fun saveActiveThreadId(id: String?) {
        prefs.edit().putString("active_thread_id", id).apply()
    }

    fun getActiveThreadId(): String? = prefs.getString("active_thread_id", null)

    fun clearHistory() {
        prefs.edit().clear().apply()
    }
}

package com.minio.mobile.data

import kotlinx.serialization.Serializable

@Serializable
data class Connection(
    val url: String,
    val token: String
)

@Serializable
data class ConnectionProfile(
    val id: String = java.util.UUID.randomUUID().toString(),
    val name: String,
    val url: String,
    val token: String
)

@Serializable
data class FileItem(
    val name: String,
    val path: String,
    val isDirectory: Boolean,
    val size: Long? = null,
    val modified: Double? = null
)

@Serializable
data class FileContentResponse(
    val content: String,
    val modified: Double? = null,
    val size: Long? = null,
    val path: String? = null
)

@Serializable
data class FileSaveResponse(
    val message: String,
    val modified: Double? = null,
    val size: Long? = null
)

@Serializable
data class ChatMessage(
    val id: String = java.util.UUID.randomUUID().toString(),
    val role: String, // "user", "assistant", "system"
    val content: String,
    val timestamp: Long = System.currentTimeMillis(),
    val isStreaming: Boolean = false,
    val toolCall: String? = null,
    val toolResult: String? = null
)

@Serializable
data class StreamResponse(
    val type: String = "token", // "token", "tool_call", "tool_result", "error", "done"
    val data: String? = null,
    val name: String? = null,
    val content: String? = null
)

@Serializable
data class ModelInfo(
    val name: String,
    val size: Long? = null,
    val modifiedAt: String? = null,
    val parameterSize: String? = null,
    val quantizationLevel: String? = null,
    val family: String? = null
)

@Serializable
data class ServerHealth(
    val status: String = "ok",
    val version: String = "1.0.0",
    val platform: String? = null,
    val host: String? = null,
    val uptime: Double? = null,
    val ollama: String? = null,
    val timestamp: String? = null
)

@Serializable
data class DiagnosticInfo(
    val version: String = "",
    val uptime: Double = 0.0,
    val workspaceDir: String = "",
    val logCount: Int = 0,
    val errorCount: Int = 0,
    val activeConnections: Int = 0
)

@Serializable
data class PlatformInfo(
    val platform: String = "unknown",
    val arch: String = "unknown",
    val nodeVersion: String = "",
    val isWindows: Boolean = false,
    val isLinux: Boolean = false,
    val isDarwin: Boolean = false,
    val workspaceDir: String = ""
)

@Serializable
data class SaveFileRequest(
    val path: String,
    val content: String,
    val expected_modified: Double? = null
)

@Serializable
data class FileOperationRequest(
    val operation: String,
    val path: String,
    val target: String? = null
)

@Serializable
data class ChatRequest(
    val model: String,
    val messages: List<ChatMessage>,
    val conversationId: String? = null,
    val useTools: Boolean = false
)

enum class ScreenTab {
    CHAT,
    WORKSPACE,
    DIAGNOSTICS,
    SETTINGS
}

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
    val type: String, // "token", "tool_call", "tool_result", "error", "done"
    val data: String? = null,
    val name: String? = null
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
    val status: String,
    val version: String,
    val platform: String? = null,
    val host: String? = null,
    val uptime: Double? = null
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

enum class ScreenTab {
    CHAT,
    WORKSPACE,
    DIAGNOSTICS,
    SETTINGS
}

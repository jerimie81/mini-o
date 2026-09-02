package com.minio.mobile.data

import com.minio.mobile.util.DispatchersProvider
import kotlinx.coroutines.withContext

class MiniORepository(
    val connectionStore: ConnectionStore,
    val chatStorage: ChatStorage,
    private val dispatchers: DispatchersProvider
) {
    private var apiClient: MiniOApiClient? = null
    var activeConnection: Connection? = null
        private set

    fun initClient(connection: Connection, connectTimeoutSec: Long = 10, readTimeoutSec: Long = 60): MiniOApiClient {
        activeConnection = connection
        val client = MiniOApiClientImpl(connection, connectTimeoutSec, readTimeoutSec)
        apiClient = client
        return client
    }

    fun getClient(): MiniOApiClient? = apiClient

    fun disconnect() {
        apiClient = null
        activeConnection = null
    }

    suspend fun checkHealth(): Result<ServerHealth> = withContext(dispatchers.io) {
        apiClient?.checkHealth() ?: Result.failure(ApiError.Network("Client not connected"))
    }

    suspend fun getPlatform(): Result<PlatformInfo> = withContext(dispatchers.io) {
        apiClient?.getPlatform() ?: Result.failure(ApiError.Network("Client not connected"))
    }

    suspend fun getDiagnostics(): Result<DiagnosticInfo> = withContext(dispatchers.io) {
        apiClient?.getDiagnostics() ?: Result.failure(ApiError.Network("Client not connected"))
    }

    suspend fun getModels(): Result<List<ModelInfo>> = withContext(dispatchers.io) {
        apiClient?.getModels() ?: Result.failure(ApiError.Network("Client not connected"))
    }

    suspend fun listFiles(path: String = ".", query: String = ""): Result<List<FileItem>> = withContext(dispatchers.io) {
        apiClient?.listFiles(path, query) ?: Result.failure(ApiError.Network("Client not connected"))
    }

    suspend fun getFileContent(path: String): Result<FileContentResponse> = withContext(dispatchers.io) {
        apiClient?.getFileContent(path) ?: Result.failure(ApiError.Network("Client not connected"))
    }

    suspend fun saveFileContent(path: String, content: String, expectedModified: Double? = null): Result<FileSaveResponse> = withContext(dispatchers.io) {
        apiClient?.saveFileContent(path, content, expectedModified) ?: Result.failure(ApiError.Network("Client not connected"))
    }

    suspend fun performFileOperation(operation: String, srcPath: String, dstPath: String? = null): Result<Boolean> = withContext(dispatchers.io) {
        apiClient?.performFileOperation(operation, srcPath, dstPath) ?: Result.failure(ApiError.Network("Client not connected"))
    }

    suspend fun streamChat(
        model: String,
        messages: List<ChatMessage>,
        conversationId: String?,
        useTools: Boolean = true,
        onToken: (String) -> Unit,
        onToolCall: (name: String, args: String) -> Unit,
        onToolResult: (name: String, result: String) -> Unit,
        onDone: () -> Unit,
        onError: (String) -> Unit
    ) = withContext(dispatchers.io) {
        apiClient?.streamChat(
            model = model,
            messages = messages,
            conversationId = conversationId,
            useTools = useTools,
            onToken = onToken,
            onToolCall = onToolCall,
            onToolResult = onToolResult,
            onDone = onDone,
            onError = onError
        ) ?: onError("Client not connected")
    }
}

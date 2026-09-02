package com.minio.mobile.data

interface MiniOApiClient {
    suspend fun checkHealth(): Result<ServerHealth>
    suspend fun getPlatform(): Result<PlatformInfo>
    suspend fun getDiagnostics(): Result<DiagnosticInfo>
    suspend fun getModels(): Result<List<ModelInfo>>
    suspend fun listFiles(path: String = ".", query: String = ""): Result<List<FileItem>>
    suspend fun getFileContent(path: String): Result<FileContentResponse>
    suspend fun saveFileContent(path: String, content: String, expectedModified: Double? = null): Result<FileSaveResponse>
    suspend fun performFileOperation(operation: String, srcPath: String, dstPath: String? = null): Result<Boolean>
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
    )
}

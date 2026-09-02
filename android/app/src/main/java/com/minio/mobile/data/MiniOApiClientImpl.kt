package com.minio.mobile.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.encodeToString
import kotlinx.serialization.decodeFromString
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class MiniOApiClientImpl(private val connection: Connection) : MiniOApiClient {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val jsonParser = Json { ignoreUnknownKeys = true; isLenient = true }

    private fun baseUrl(): String = connection.url.trimEnd('/')

    private fun validatePath(path: String) {
        if (path.contains("..")) throw IllegalArgumentException("Invalid path: $path")
    }

    private suspend fun <T> retry(
        times: Int = 3,
        initialDelay: Long = 100,
        block: suspend () -> T
    ): T {
        var currentDelay = initialDelay
        repeat(times - 1) {
            try {
                return block()
            } catch (e: Exception) {
                android.util.Log.e("MiniOApiClient", "Retryable error: ${e.javaClass.simpleName}")
            }
            kotlinx.coroutines.delay(currentDelay)
            currentDelay *= 2
        }
        return block()
    }

    private fun newRequestBuilder(path: String): Request.Builder {
[diff_block_end]
    override suspend fun checkHealth(): Result<ServerHealth> = withContext(Dispatchers.IO) {
        try {
            retry {
                val req = newRequestBuilder("/api/health").get().build()
                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) throw Exception("Health check failed (${res.code})")
                    val body = res.body?.string() ?: "{}"
                    jsonParser.decodeFromString<ServerHealth>(body)
                }
            }.let { Result.success(it) }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun getPlatform(): Result<PlatformInfo> = withContext(Dispatchers.IO) {
        try {
            retry {
                val req = newRequestBuilder("/api/platform").get().build()
                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) throw Exception("Platform check failed (${res.code})")
                    val body = res.body?.string() ?: "{}"
                    jsonParser.decodeFromString<PlatformInfo>(body)
                }
            }.let { Result.success(it) }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun getDiagnostics(): Result<DiagnosticInfo> = withContext(Dispatchers.IO) {
        try {
            retry {
                val req = newRequestBuilder("/api/diagnostics").get().build()
                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) throw Exception("Diagnostics failed (${res.code})")
                    val body = res.body?.string() ?: "{}"
                    jsonParser.decodeFromString<DiagnosticInfo>(body)
                }
            }.let { Result.success(it) }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun getModels(): Result<List<ModelInfo>> = withContext(Dispatchers.IO) {
        try {
            retry {
                val req = newRequestBuilder("/api/models").get().build()
                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) throw Exception("Failed to fetch models (${res.code})")
                    val body = res.body?.string() ?: "[]"
                    jsonParser.decodeFromString<List<ModelInfo>>(body)
                }
            }.let { Result.success(it) }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun listFiles(path: String, query: String): Result<List<FileItem>> = withContext(Dispatchers.IO) {
        try {
            validatePath(path)
            retry {
                val encPath = URLEncoder.encode(path, "UTF-8")
                val encQ = URLEncoder.encode(query, "UTF-8")
                val req = newRequestBuilder("/api/files?path=$encPath&q=$encQ").get().build()
                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) throw Exception("Failed to list files (${res.code})")
                    val body = res.body?.string() ?: "[]"
                    val items = jsonParser.decodeFromString<List<FileItem>>(body).toMutableList()
                    items.sortWith(compareByDescending<FileItem> { it.isDirectory }.thenBy { it.name.lowercase() })
                    items
                }
            }.let { Result.success(it) }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun getFileContent(path: String): Result<FileContentResponse> = withContext(Dispatchers.IO) {
        try {
            validatePath(path)
            retry {
                val encPath = URLEncoder.encode(path, "UTF-8")
                val req = newRequestBuilder("/api/files/content?path=$encPath").get().build()
                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) throw Exception("Failed to load file content (${res.code})")
                    val body = res.body?.string() ?: "{}"
                    jsonParser.decodeFromString<FileContentResponse>(body)
                }
            }.let { Result.success(it) }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun saveFileContent(path: String, content: String, expectedModified: Double?): Result<FileSaveResponse> = withContext(Dispatchers.IO) {
        try {
            validatePath(path)
            retry {
                val payload = mapOf("path" to path, "content" to content, "expected_modified" to expectedModified)
                val reqBody = jsonParser.encodeToString(payload).toRequestBody(jsonMediaType)
                val req = newRequestBuilder("/api/files/content").post(reqBody).build()
                client.newCall(req).execute().use { res ->
                    val body = res.body?.string() ?: "{}"
                    if (!res.isSuccessful) throw Exception("Failed to save file (${res.code})")
                    jsonParser.decodeFromString<FileSaveResponse>(body)
                }
            }.let { Result.success(it) }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun performFileOperation(operation: String, srcPath: String, dstPath: String?): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            validatePath(srcPath)
            dstPath?.let { validatePath(it) }
            retry {
                val payload = mutableMapOf("operation" to operation, "path" to srcPath)
                if (dstPath != null) payload["target"] = dstPath
                val reqBody = jsonParser.encodeToString(payload).toRequestBody(jsonMediaType)
                val req = newRequestBuilder("/api/files/operation").post(reqBody).build()
                client.newCall(req).execute().use { res ->
                    if (!res.isSuccessful) throw Exception("File operation failed (${res.code})")
                    true
                }
            }.let { Result.success(it) }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    override suspend fun streamChat(
        model: String,
        messages: List<ChatMessage>,
        conversationId: String?,
        useTools: Boolean,
        onToken: (String) -> Unit,
        onToolCall: (name: String, args: String) -> Unit,
        onToolResult: (name: String, result: String) -> Unit,
        onDone: () -> Unit,
        onError: (String) -> Unit
    ) = withContext(Dispatchers.IO) {
        try {
            val payload = mapOf(
                "model" to model,
                "messages" to messages,
                "conversationId" to conversationId,
                "useTools" to useTools
            )
            val reqBody = jsonParser.encodeToString(payload).toRequestBody(jsonMediaType)
            val req = newRequestBuilder("/api/chat").post(reqBody).build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) {
                    onError("Failed to start chat (${res.code})")
                    return@withContext
                }
                res.body?.charStream()?.buffered()?.use { reader ->
                    reader.forEachLine { line ->
                        if (line.startsWith("data: ")) {
                            val jsonPart = line.substring(6)
                            try {
                                val msg = jsonParser.decodeFromString<StreamResponse>(jsonPart)
                                when (msg.type) {
                                    "token" -> msg.data?.let { onToken(it) }
                                    "tool_call" -> msg.name?.let { onToolCall(it, msg.data ?: "") }
                                    "tool_result" -> msg.name?.let { onToolResult(it, msg.data ?: "") }
                                    "error" -> onError(msg.data ?: "Unknown error")
                                    "done" -> { onDone(); return@forEachLine }
                                }
                            } catch (e: Exception) {
                                onError("Parse error: ${e.message}")
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            onError(e.message ?: "Chat stream failed")
        }
    }
}

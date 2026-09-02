package com.minio.mobile.data

import com.minio.mobile.util.Formatters
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.withContext
import kotlinx.serialization.decodeFromString
import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import okhttp3.*
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.net.ConnectException
import java.net.SocketTimeoutException
import java.net.URLEncoder
import java.net.UnknownHostException
import java.util.concurrent.TimeUnit
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

class MiniOApiClientImpl(
    private val connection: Connection,
    connectTimeoutSec: Long = 10,
    readTimeoutSec: Long = 60
) : MiniOApiClient {

    private val client = OkHttpClient.Builder()
        .connectTimeout(connectTimeoutSec, TimeUnit.SECONDS)
        .readTimeout(readTimeoutSec, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()
    private val jsonParser = Json { ignoreUnknownKeys = true; isLenient = true }

    private fun baseUrl(): String = connection.url.trimEnd('/')

    private fun validatePath(path: String) {
        Formatters.sanitizePath(path)
    }

    private suspend fun Call.awaitResponse(): Response {
        return suspendCancellableCoroutine { continuation ->
            continuation.invokeOnCancellation {
                cancel()
            }
            enqueue(object : Callback {
                override fun onResponse(call: Call, response: Response) {
                    continuation.resume(response)
                }

                override fun onFailure(call: Call, e: IOException) {
                    if (continuation.isCancelled) return
                    val apiErr = when (e) {
                        is UnknownHostException -> ApiError.Network("Server DNS address not found: ${e.message}", e)
                        is ConnectException -> ApiError.Network("Connection refused by host", e)
                        is SocketTimeoutException -> ApiError.Timeout("Request timed out")
                        else -> ApiError.Network(e.message ?: "Network call failed", e)
                    }
                    continuation.resumeWithException(apiErr)
                }
            })
        }
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
                if (e is ApiError.Auth) throw e
                android.util.Log.e("MiniOApiClient", "Retryable error: ${e.javaClass.simpleName} - ${e.message}")
            }
            kotlinx.coroutines.delay(currentDelay)
            currentDelay *= 2
        }
        return block()
    }

    private fun newRequestBuilder(path: String): Request.Builder {
        val fullUrl = "${baseUrl()}$path"
        val builder = Request.Builder().url(fullUrl)
        if (connection.token.isNotBlank()) {
            builder.header("Authorization", "Bearer ${connection.token}")
        }
        return builder
    }

    private fun checkResponseStatus(res: Response) {
        if (!res.isSuccessful) {
            when (res.code) {
                401, 403 -> throw ApiError.Auth()
                else -> throw ApiError.Server(res.code, res.message.ifBlank { "HTTP Error ${res.code}" })
            }
        }
    }

    override suspend fun checkHealth(): Result<ServerHealth> = withContext(Dispatchers.IO) {
        try {
            retry {
                val req = newRequestBuilder("/api/health").get().build()
                client.newCall(req).awaitResponse().use { res ->
                    checkResponseStatus(res)
                    val body = res.body?.string() ?: "{}"
                    jsonParser.decodeFromString<ServerHealth>(body)
                }
            }.let { Result.success(it) }
        } catch (e: ApiError) {
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(ApiError.Unknown(e.message ?: "Health check failed", e))
        }
    }

    override suspend fun getPlatform(): Result<PlatformInfo> = withContext(Dispatchers.IO) {
        try {
            retry {
                val req = newRequestBuilder("/api/platform").get().build()
                client.newCall(req).awaitResponse().use { res ->
                    checkResponseStatus(res)
                    val body = res.body?.string() ?: "{}"
                    jsonParser.decodeFromString<PlatformInfo>(body)
                }
            }.let { Result.success(it) }
        } catch (e: ApiError) {
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(ApiError.Unknown(e.message ?: "Platform check failed", e))
        }
    }

    override suspend fun getDiagnostics(): Result<DiagnosticInfo> = withContext(Dispatchers.IO) {
        try {
            retry {
                val req = newRequestBuilder("/api/diagnostics").get().build()
                client.newCall(req).awaitResponse().use { res ->
                    checkResponseStatus(res)
                    val body = res.body?.string() ?: "{}"
                    jsonParser.decodeFromString<DiagnosticInfo>(body)
                }
            }.let { Result.success(it) }
        } catch (e: ApiError) {
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(ApiError.Unknown(e.message ?: "Diagnostics failed", e))
        }
    }

    override suspend fun getModels(): Result<List<ModelInfo>> = withContext(Dispatchers.IO) {
        try {
            retry {
                val req = newRequestBuilder("/api/models").get().build()
                client.newCall(req).awaitResponse().use { res ->
                    checkResponseStatus(res)
                    val body = res.body?.string() ?: "[]"
                    jsonParser.decodeFromString<List<ModelInfo>>(body)
                }
            }.let { Result.success(it) }
        } catch (e: ApiError) {
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(ApiError.Unknown(e.message ?: "Failed to fetch models", e))
        }
    }

    override suspend fun listFiles(path: String, query: String): Result<List<FileItem>> = withContext(Dispatchers.IO) {
        try {
            validatePath(path)
            retry {
                val encPath = URLEncoder.encode(path, "UTF-8")
                val encQ = URLEncoder.encode(query, "UTF-8")
                val req = newRequestBuilder("/api/files?path=$encPath&q=$encQ").get().build()
                client.newCall(req).awaitResponse().use { res ->
                    checkResponseStatus(res)
                    val body = res.body?.string() ?: "[]"
                    val items = jsonParser.decodeFromString<List<FileItem>>(body).toMutableList()
                    items.sortWith(compareByDescending<FileItem> { it.isDirectory }.thenBy { it.name.lowercase() })
                    items
                }
            }.let { Result.success(it) }
        } catch (e: ApiError) {
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(ApiError.Unknown(e.message ?: "Failed to list files", e))
        }
    }

    override suspend fun getFileContent(path: String): Result<FileContentResponse> = withContext(Dispatchers.IO) {
        try {
            validatePath(path)
            retry {
                val encPath = URLEncoder.encode(path, "UTF-8")
                val req = newRequestBuilder("/api/files/content?path=$encPath").get().build()
                client.newCall(req).awaitResponse().use { res ->
                    checkResponseStatus(res)
                    val body = res.body?.string() ?: "{}"
                    jsonParser.decodeFromString<FileContentResponse>(body)
                }
            }.let { Result.success(it) }
        } catch (e: ApiError) {
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(ApiError.Unknown(e.message ?: "Failed to load file content", e))
        }
    }

    override suspend fun saveFileContent(path: String, content: String, expectedModified: Double?): Result<FileSaveResponse> = withContext(Dispatchers.IO) {
        try {
            validatePath(path)
            retry {
                val payload = mapOf("path" to path, "content" to content, "expected_modified" to expectedModified)
                val reqBody = jsonParser.encodeToString(payload).toRequestBody(jsonMediaType)
                val req = newRequestBuilder("/api/files/content").post(reqBody).build()
                client.newCall(req).awaitResponse().use { res ->
                    checkResponseStatus(res)
                    val body = res.body?.string() ?: "{}"
                    jsonParser.decodeFromString<FileSaveResponse>(body)
                }
            }.let { Result.success(it) }
        } catch (e: ApiError) {
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(ApiError.Unknown(e.message ?: "Failed to save file", e))
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
                client.newCall(req).awaitResponse().use { res ->
                    checkResponseStatus(res)
                    true
                }
            }.let { Result.success(it) }
        } catch (e: ApiError) {
            Result.failure(e)
        } catch (e: Exception) {
            Result.failure(ApiError.Unknown(e.message ?: "File operation failed", e))
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
            
            client.newCall(req).awaitResponse().use { res ->
                if (!res.isSuccessful) {
                    if (res.code == 401 || res.code == 403) {
                        onError("Authentication error (401/403): Token invalid")
                    } else {
                        onError("Failed to start chat (${res.code})")
                    }
                    return@withContext
                }
                
                res.body?.charStream()?.buffered()?.use { reader ->
                    var buffer = StringBuilder()
                    reader.forEachLine { line ->
                        if (line.startsWith("data: ")) {
                            val jsonPart = line.substring(6)
                            buffer.append(jsonPart)
                            try {
                                val msg = jsonParser.decodeFromString<StreamResponse>(buffer.toString())
                                buffer.clear()
                                when (msg.type) {
                                    "token" -> msg.data?.let { onToken(it) }
                                    "tool_call" -> msg.name?.let { onToolCall(it, msg.data ?: "") }
                                    "tool_result" -> msg.name?.let { onToolResult(it, msg.data ?: "") }
                                    "error" -> onError(msg.data ?: "Unknown error")
                                    "done" -> { onDone(); return@forEachLine }
                                }
                            } catch (e: Exception) {
                                // Keep reading into buffer if partial JSON
                            }
                        }
                    }
                }
            }
        } catch (e: Exception) {
            val userMsg = if (e is ApiError) e.toUserMessage() else (e.message ?: "Chat stream failed")
            onError(userMsg)
        }
    }
}

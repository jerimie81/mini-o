package com.minio.mobile.data

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.BufferedReader
import java.io.InputStreamReader
import java.net.URLEncoder
import java.util.concurrent.TimeUnit

class MiniOApiClient(private val connection: Connection) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(10, TimeUnit.SECONDS)
        .readTimeout(60, TimeUnit.SECONDS)
        .writeTimeout(30, TimeUnit.SECONDS)
        .build()

    private val jsonMediaType = "application/json; charset=utf-8".toMediaType()

    private fun baseUrl(): String = connection.url.trimEnd('/')

    private fun newRequestBuilder(path: String): Request.Builder {
        val url = "${baseUrl()}$path"
        val builder = Request.Builder().url(url)
        if (connection.token.isNotBlank()) {
            builder.header("Authorization", "Bearer ${connection.token.trim()}")
        }
        return builder
    }

    suspend fun checkHealth(): Result<ServerHealth> = withContext(Dispatchers.IO) {
        try {
            val req = newRequestBuilder("/api/health").get().build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return@withContext Result.failure(Exception("Health check failed (${res.code})"))
                val body = res.body?.string() ?: "{}"
                val json = JSONObject(body)
                val status = json.optString("status", "ok")
                val version = json.optString("version", "0.1.0")
                val platform = json.optString("platform", null)
                val host = json.optString("host", null)
                val uptime = if (json.has("uptime")) json.optDouble("uptime") else null
                Result.success(ServerHealth(status, version, platform, host, uptime))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getPlatform(): Result<PlatformInfo> = withContext(Dispatchers.IO) {
        try {
            val req = newRequestBuilder("/api/platform").get().build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return@withContext Result.failure(Exception("Platform check failed (${res.code})"))
                val body = res.body?.string() ?: "{}"
                val json = JSONObject(body)
                val platform = json.optString("platform", "unknown")
                val arch = json.optString("arch", "x64")
                val nodeVer = json.optString("node_version", "")
                val isWin = json.optBoolean("is_windows", false)
                val isLin = json.optBoolean("is_linux", false)
                val isDar = json.optBoolean("is_darwin", false)
                val pathsObj = json.optJSONObject("paths")
                val wsDir = pathsObj?.optString("workspace_dir", "") ?: ""
                Result.success(PlatformInfo(platform, arch, nodeVer, isWin, isLin, isDar, wsDir))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getDiagnostics(): Result<DiagnosticInfo> = withContext(Dispatchers.IO) {
        try {
            val req = newRequestBuilder("/api/diagnostics").get().build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return@withContext Result.failure(Exception("Diagnostics failed (${res.code})"))
                val body = res.body?.string() ?: "{}"
                val json = JSONObject(body)
                val ver = json.optString("version", "0.1.0")
                val up = json.optDouble("uptime", 0.0)
                val ws = json.optString("workspace_dir", "")
                val logs = json.optInt("log_count", 0)
                val errors = json.optInt("error_count", 0)
                Result.success(DiagnosticInfo(ver, up, ws, logs, errors))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getModels(): Result<List<ModelInfo>> = withContext(Dispatchers.IO) {
        try {
            val req = newRequestBuilder("/api/models").get().build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return@withContext Result.failure(Exception("Failed to fetch models (${res.code})"))
                val body = res.body?.string() ?: "[]"
                val list = mutableListOf<ModelInfo>()
                if (body.trim().startsWith("[")) {
                    val array = JSONArray(body)
                    for (i in 0 until array.length()) {
                        val obj = array.getJSONObject(i)
                        val details = obj.optJSONObject("details")
                        list.add(
                            ModelInfo(
                                name = obj.optString("name", "unknown"),
                                size = if (obj.has("size")) obj.optLong("size") else null,
                                modifiedAt = obj.optString("modified_at", null),
                                parameterSize = details?.optString("parameter_size", null),
                                quantizationLevel = details?.optString("quantization_level", null),
                                family = details?.optString("family", null)
                            )
                        )
                    }
                } else {
                    val obj = JSONObject(body)
                    val array = obj.optJSONArray("models") ?: JSONArray()
                    for (i in 0 until array.length()) {
                        val m = array.getJSONObject(i)
                        val details = m.optJSONObject("details")
                        list.add(
                            ModelInfo(
                                name = m.optString("name", "unknown"),
                                size = if (m.has("size")) m.optLong("size") else null,
                                modifiedAt = m.optString("modified_at", null),
                                parameterSize = details?.optString("parameter_size", null),
                                quantizationLevel = details?.optString("quantization_level", null),
                                family = details?.optString("family", null)
                            )
                        )
                    }
                }
                Result.success(list)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun listFiles(path: String = ".", query: String = ""): Result<List<FileItem>> = withContext(Dispatchers.IO) {
        try {
            val encPath = URLEncoder.encode(path, "UTF-8")
            val encQ = URLEncoder.encode(query, "UTF-8")
            val req = newRequestBuilder("/api/files?path=$encPath&q=$encQ").get().build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return@withContext Result.failure(Exception("Failed to list files (${res.code})"))
                val body = res.body?.string() ?: "[]"
                val array = JSONArray(body)
                val items = mutableListOf<FileItem>()
                for (i in 0 until array.length()) {
                    val obj = array.getJSONObject(i)
                    items.add(
                        FileItem(
                            name = obj.optString("name", ""),
                            path = obj.optString("path", ""),
                            isDirectory = obj.optBoolean("is_dir", false),
                            size = if (obj.isNull("size")) null else obj.optLong("size"),
                            modified = if (obj.isNull("modified")) null else obj.optDouble("modified")
                        )
                    )
                }
                items.sortWith(compareByDescending<FileItem> { it.isDirectory }.thenBy { it.name.lowercase() })
                Result.success(items)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun getFileContent(path: String): Result<FileContentResponse> = withContext(Dispatchers.IO) {
        try {
            val encPath = URLEncoder.encode(path, "UTF-8")
            val req = newRequestBuilder("/api/files/content?path=$encPath").get().build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return@withContext Result.failure(Exception("Failed to load file content (${res.code})"))
                val body = res.body?.string() ?: "{}"
                val json = JSONObject(body)
                val content = json.optString("content", "")
                val mod = if (json.has("modified")) json.optDouble("modified") else null
                val size = if (json.has("size")) json.optLong("size") else null
                Result.success(FileContentResponse(content, mod, size, path))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun saveFileContent(path: String, content: String, expectedModified: Double? = null): Result<FileSaveResponse> = withContext(Dispatchers.IO) {
        try {
            val payload = JSONObject().apply {
                put("path", path)
                put("content", content)
                if (expectedModified != null) {
                    put("expected_modified", expectedModified)
                }
            }
            val reqBody = payload.toString().toRequestBody(jsonMediaType)
            val req = newRequestBuilder("/api/files/content").post(reqBody).build()
            client.newCall(req).execute().use { res ->
                val body = res.body?.string() ?: "{}"
                if (!res.isSuccessful) {
                    val json = runCatching { JSONObject(body) }.getOrNull()
                    val msg = json?.optString("message") ?: "Failed to save file (${res.code})"
                    return@withContext Result.failure(Exception(msg))
                }
                val json = JSONObject(body)
                val msg = json.optString("message", "Saved")
                val mod = if (json.has("modified")) json.optDouble("modified") else null
                val size = if (json.has("size")) json.optLong("size") else null
                Result.success(FileSaveResponse(msg, mod, size))
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
    }

    suspend fun performFileOperation(operation: String, srcPath: String, dstPath: String? = null): Result<Boolean> = withContext(Dispatchers.IO) {
        try {
            val payload = JSONObject().apply {
                put("operation", operation)
                put("path", srcPath)
                if (dstPath != null) put("target", dstPath)
            }
            val reqBody = payload.toString().toRequestBody(jsonMediaType)
            val req = newRequestBuilder("/api/files/operation").post(reqBody).build()
            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) {
                    val body = res.body?.string() ?: "{}"
                    val json = runCatching { JSONObject(body) }.getOrNull()
                    val msg = json?.optString("message") ?: "File operation failed (${res.code})"
                    return@withContext Result.failure(Exception(msg))
                }
                Result.success(true)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }
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
    ) = withContext(Dispatchers.IO) {
        try {
            val msgsArray = JSONArray()
            for (m in messages) {
                msgsArray.put(JSONObject().apply {
                    put("role", m.role)
                    put("content", m.content)
                })
            }
            val payload = JSONObject().apply {
                put("model", model)
                put("messages", msgsArray)
                if (conversationId != null) put("conversation_id", conversationId)
                put("use_tools", useTools)
            }
            val reqBody = payload.toString().toRequestBody(jsonMediaType)
            val req = newRequestBuilder("/api/chat/stream").post(reqBody).build()

            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) {
                    onError("Chat stream error (${res.code})")
                    return@withContext
                }
                val stream = res.body?.byteStream() ?: run {
                    onError("Empty response stream")
                    return@withContext
                }

                val reader = BufferedReader(InputStreamReader(stream, "UTF-8"))
                var line: String?
                var currentEvent: String? = null

                while (reader.readLine().also { line = it } != null) {
                    val l = line?.trim() ?: continue
                    if (l.startsWith("event:")) {
                        currentEvent = l.substringAfter("event:").trim()
                    } else if (l.startsWith("data:")) {
                        val rawData = l.substringAfter("data:").trim()
                        if (rawData.isEmpty()) continue
                        try {
                            val dataJson = JSONObject(rawData)
                            when (currentEvent) {
                                "token" -> {
                                    val text = dataJson.optString("content", "")
                                    if (text.isNotEmpty()) onToken(text)
                                }
                                "tool_call" -> {
                                    val name = dataJson.optString("name", "tool")
                                    val args = dataJson.optJSONObject("args")?.toString() ?: "{}"
                                    onToolCall(name, args)
                                }
                                "tool_result" -> {
                                    val name = dataJson.optString("name", "tool")
                                    val out = dataJson.optString("output", "")
                                    onToolResult(name, out)
                                }
                                "error" -> {
                                    val err = dataJson.optString("detail", dataJson.optString("error", "Stream error"))
                                    onError(err)
                                }
                                "done", "end" -> {
                                    // stream complete
                                }
                            }
                        } catch (_: Exception) {
                            // Non-json token or keep-alive
                        }
                    }
                }
                onDone()
            }
        } catch (e: Exception) {
            onError(e.message ?: "Chat stream exception")
        }
    }
}

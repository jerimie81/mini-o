package com.minio.mcp

import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse

class MiniOMcpClient(private val endpoint: String = "http://127.0.0.1:8000/api/mcp") {
    private val http = HttpClient.newHttpClient()
    private var id = 0
    fun request(method: String, params: String = "{}"): String {
        val body = "{\"jsonrpc\":\"2.0\",\"id\":${++id},\"method\":\"$method\",\"params\":$params}"
        val request = HttpRequest.newBuilder(URI.create(endpoint))
            .header("content-type", "application/json")
            .header("MCP-Protocol-Version", "2025-11-25")
            .POST(HttpRequest.BodyPublishers.ofString(body)).build()
        return http.send(request, HttpResponse.BodyHandlers.ofString()).body()
    }
    fun initialize() = request("initialize", "{\"protocolVersion\":\"2025-11-25\",\"capabilities\":{}}")
    fun listTools() = request("tools/list")
    fun sendSelection(label: String, text: String) = request("context/submit", "{\"client_id\":\"jetbrains\",\"items\":[{\"kind\":\"selection\",\"label\":${quote(label)},\"text\":${quote(text)}}]}")

    private fun quote(value: String): String = "\"" + value
        .replace("\\", "\\\\")
        .replace("\"", "\\\"")
        .replace("\n", "\\n")
        .replace("\r", "\\r") + "\""
}

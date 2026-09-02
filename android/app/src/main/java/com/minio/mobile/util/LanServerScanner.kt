package com.minio.mobile.util

import android.content.Context
import android.net.wifi.WifiManager
import com.minio.mobile.data.ServerHealth
import kotlinx.coroutines.*
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOn
import kotlinx.serialization.json.Json
import kotlinx.serialization.decodeFromString
import okhttp3.OkHttpClient
import okhttp3.Request
import java.net.InetAddress
import java.net.NetworkInterface
import java.util.concurrent.TimeUnit

data class DiscoveredServer(
    val ip: String,
    val port: Int,
    val url: String,
    val name: String,
    val latencyMs: Long
)

class LanServerScanner(private val context: Context) {
    private val client = OkHttpClient.Builder()
        .connectTimeout(600, TimeUnit.MILLISECONDS)
        .readTimeout(600, TimeUnit.MILLISECONDS)
        .build()

    private val json = Json { ignoreUnknownKeys = true }
    private val targetPorts = listOf(3000, 8000, 8080)

    fun getLocalSubnetPrefix(): String? {
        try {
            val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as? WifiManager
            val wifiInfo = wifiManager?.connectionInfo
            val ipInt = wifiInfo?.ipAddress ?: 0
            if (ipInt != 0) {
                return String.format(
                    "%d.%d.%d.",
                    ipInt and 0xff,
                    ipInt shr 8 and 0xff,
                    ipInt shr 16 and 0xff
                )
            }

            // Fallback to NetworkInterface
            val interfaces = NetworkInterface.getNetworkInterfaces()
            while (interfaces.hasMoreElements()) {
                val iface = interfaces.nextElement()
                if (iface.isLoopback || !iface.isUp) continue
                val addresses = iface.inetAddresses
                while (addresses.hasMoreElements()) {
                    val addr = addresses.nextElement()
                    val host = addr.hostAddress
                    if (host != null && host.startsWith("192.168.")) {
                        return host.substringBeforeLast('.') + "."
                    } else if (host != null && host.startsWith("10.")) {
                        return host.substringBeforeLast('.') + "."
                    }
                }
            }
        } catch (e: Exception) {
            android.util.Log.e("LanServerScanner", "Failed to get local IP: ${e.message}")
        }
        return null
    }

    fun scanSubnet(
        ports: List<Int> = targetPorts,
        onProgress: (scanned: Int, total: Int) -> Unit = { _, _ -> }
    ): Flow<DiscoveredServer> = flow {
        val subnetPrefix = getLocalSubnetPrefix() ?: "192.168.1."
        val candidateIps = (1..254).map { "$subnetPrefix$it" } + listOf("10.0.2.2", "127.0.0.1", "localhost")
        val total = candidateIps.size * ports.size
        var scannedCount = 0

        coroutineScope {
            val jobs = candidateIps.flatMap { ip ->
                ports.map { port ->
                    async(Dispatchers.IO) {
                        val server = checkServer(ip, port)
                        synchronized(this@coroutineScope) {
                            scannedCount++
                            onProgress(scannedCount, total)
                        }
                        server
                    }
                }
            }

            jobs.forEach { job ->
                val result = job.await()
                if (result != null) {
                    emit(result)
                }
            }
        }
    }.flowOn(Dispatchers.IO)

    private fun checkServer(ip: String, port: Int): DiscoveredServer? {
        val url = "http://$ip:$port"
        val healthUrl = "$url/api/health"
        val request = Request.Builder().url(healthUrl).get().build()
        val startTime = System.currentTimeMillis()

        return try {
            client.newCall(request).execute().use { response ->
                val elapsed = System.currentTimeMillis() - startTime
                if (response.isSuccessful) {
                    val body = response.body?.string() ?: "{}"
                    val health = json.decodeFromString<ServerHealth>(body)
                    if (health.status == "ok" || health.version.isNotBlank()) {
                        val serverName = health.host?.let { "Mini-O ($it)" } ?: "Mini-O Host ($ip)"
                        DiscoveredServer(
                            ip = ip,
                            port = port,
                            url = url,
                            name = serverName,
                            latencyMs = elapsed
                        )
                    } else null
                } else null
            }
        } catch (e: Exception) {
            null
        }
    }
}

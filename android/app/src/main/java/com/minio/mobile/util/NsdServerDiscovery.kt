package com.minio.mobile.util

import android.content.Context
import android.net.nsd.NsdManager
import android.net.nsd.NsdServiceInfo
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import java.net.InetAddress

class NsdServerDiscovery(private val context: Context) {
    private val nsdManager = context.getSystemService(Context.NSD_SERVICE) as NsdManager
    private val serviceType = "_mini-o._tcp."

    fun discoverServices(): Flow<DiscoveredServer> = callbackFlow {
        val discoveryListener = object : NsdManager.DiscoveryListener {
            override fun onDiscoveryStarted(regType: String) {
                android.util.Log.d("NsdDiscovery", "NSD discovery started: $regType")
            }

            override fun onServiceFound(service: NsdServiceInfo) {
                if (service.serviceType.contains("mini-o")) {
                    nsdManager.resolveService(service, object : NsdManager.ResolveListener {
                        override fun onResolveFailed(serviceInfo: NsdServiceInfo, errorCode: Int) {
                            android.util.Log.e("NsdDiscovery", "Resolve failed: $errorCode")
                        }

                        override fun onServiceResolved(serviceInfo: NsdServiceInfo) {
                            val host: InetAddress = serviceInfo.host
                            val port: Int = serviceInfo.port
                            val hostAddress = host.hostAddress ?: return
                            val url = "http://$hostAddress:$port"
                            val server = DiscoveredServer(
                                ip = hostAddress,
                                port = port,
                                url = url,
                                name = serviceInfo.serviceName ?: "Mini-O mDNS Host",
                                latencyMs = 15L
                            )
                            trySend(server)
                        }
                    })
                }
            }

            override fun onServiceLost(service: NsdServiceInfo) {
                android.util.Log.d("NsdDiscovery", "Service lost: ${service.serviceName}")
            }

            override fun onDiscoveryStopped(serviceType: String) {
                android.util.Log.d("NsdDiscovery", "Discovery stopped")
            }

            override fun onStartDiscoveryFailed(serviceType: String, errorCode: Int) {
                android.util.Log.e("NsdDiscovery", "Start discovery failed: $errorCode")
                nsdManager.stopServiceDiscovery(this)
            }

            override fun onStopDiscoveryFailed(serviceType: String, errorCode: Int) {
                android.util.Log.e("NsdDiscovery", "Stop discovery failed: $errorCode")
                nsdManager.stopServiceDiscovery(this)
            }
        }

        try {
            nsdManager.discoverServices(serviceType, NsdManager.PROTOCOL_DNS_SD, discoveryListener)
        } catch (e: Exception) {
            android.util.Log.e("NsdDiscovery", "NSD Exception: ${e.message}")
        }

        awaitClose {
            try {
                nsdManager.stopServiceDiscovery(discoveryListener)
            } catch (_: Exception) {}
        }
    }
}

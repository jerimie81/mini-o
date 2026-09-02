package com.minio.mobile.util

import android.content.Context
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged

enum class NetworkStatus {
    AVAILABLE, LOST, UNAVAILABLE
}

class ConnectivityObserver(context: Context) {
    private val connectivityManager =
        context.getSystemService(Context.CONNECTIVITY_SERVICE) as ConnectivityManager

    fun observe(): Flow<NetworkStatus> = callbackFlow {
        val callback = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                trySend(NetworkStatus.AVAILABLE)
            }

            override fun onLost(network: Network) {
                trySend(NetworkStatus.LOST)
            }

            override fun onUnavailable() {
                trySend(NetworkStatus.UNAVAILABLE)
            }
        }

        val request = NetworkRequest.Builder()
            .addCapability(NetworkCapabilities.NETCAPABILITY_INTERNET)
            .build()

        connectivityManager.registerNetworkCallback(request, callback)

        val currentNetwork = connectivityManager.activeNetwork
        val caps = connectivityManager.getNetworkCapabilities(currentNetwork)
        val initialStatus = if (caps?.hasCapability(NetworkCapabilities.NETCAPABILITY_INTERNET) == true) {
            NetworkStatus.AVAILABLE
        } else {
            NetworkStatus.UNAVAILABLE
        }
        trySend(initialStatus)

        awaitClose {
            connectivityManager.unregisterNetworkCallback(callback)
        }
    }.distinctUntilChanged()
}

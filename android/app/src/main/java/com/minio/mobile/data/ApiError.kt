package com.minio.mobile.data

sealed class ApiError : Exception() {
    data class Network(override val message: String, override val cause: Throwable? = null) : ApiError()
    data class Auth(override val message: String = "Authentication failed (401/403)") : ApiError()
    data class Server(val code: Int, override val message: String) : ApiError()
    data class Parse(override val message: String, override val cause: Throwable? = null) : ApiError()
    data class Timeout(override val message: String = "Request timed out") : ApiError()
    data class Unknown(override val message: String, override val cause: Throwable? = null) : ApiError()

    fun toUserMessage(): String = when (this) {
        is Network -> "Network error: $message. Check your connection."
        is Auth -> "Authentication error: Invalid or expired token."
        is Server -> "Server error ($code): $message"
        is Parse -> "Data processing error: $message"
        is Timeout -> "Connection timed out. Server taking too long to respond."
        is Unknown -> message
    }
}

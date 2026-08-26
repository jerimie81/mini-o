package com.minio.mobile.ui.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

val InkBackground = Color(0xFF0B0F14)
val SurfacePanel = Color(0xFF141A23)
val SurfaceRaised = Color(0xFF1E2633)
val SurfaceHighlight = Color(0xFF283244)
val BorderColor = Color(0xFF2D3848)

val PrimaryBlue = Color(0xFF89A9FF)
val PrimaryBlueHover = Color(0xFFA5BFFF)
val SecondaryTeal = Color(0xFF5DE4C7)
val AccentOrange = Color(0xFFFFAB70)
val DangerRed = Color(0xFFFF8A8A)

val TextPrimary = Color(0xFFEAF0FA)
val TextSecondary = Color(0xFFB5C2D4)
val TextMuted = Color(0xFF8090A6)

val CodeBackground = Color(0xFF090D12)

private val DarkColorScheme = darkColorScheme(
    primary = PrimaryBlue,
    onPrimary = Color(0xFF002255),
    primaryContainer = SurfaceRaised,
    onPrimaryContainer = PrimaryBlue,
    secondary = SecondaryTeal,
    onSecondary = Color(0xFF00382E),
    background = InkBackground,
    onBackground = TextPrimary,
    surface = SurfacePanel,
    onSurface = TextPrimary,
    surfaceVariant = SurfaceRaised,
    onSurfaceVariant = TextSecondary,
    outline = BorderColor,
    error = DangerRed,
    onError = Color(0xFF490008)
)

private val LightColorScheme = lightColorScheme(
    primary = Color(0xFF2E5BFF),
    onPrimary = Color.White,
    primaryContainer = Color(0xFFE5ECFF),
    onPrimaryContainer = Color(0xFF001A4E),
    secondary = Color(0xFF00897B),
    onSecondary = Color.White,
    background = Color(0xFFF6F8FB),
    onBackground = Color(0xFF111827),
    surface = Color.White,
    onSurface = Color(0xFF111827),
    surfaceVariant = Color(0xFFEDF2F7),
    onSurfaceVariant = Color(0xFF4A5568),
    outline = Color(0xFFCBD5E0),
    error = Color(0xFFE53935),
    onError = Color.White
)

@Composable
fun MiniOTheme(
    darkTheme: Boolean = isSystemInDarkTheme(),
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else DarkColorScheme // default dark modern workspace

    MaterialTheme(
        colorScheme = colorScheme,
        content = content
    )
}

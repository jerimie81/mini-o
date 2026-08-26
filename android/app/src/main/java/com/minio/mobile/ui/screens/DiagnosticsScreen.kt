package com.minio.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.minio.mobile.ui.components.StatusBadge
import com.minio.mobile.ui.theme.*
import com.minio.mobile.viewmodel.MiniOViewModel
import java.util.Locale

@Composable
fun DiagnosticsScreen(vm: MiniOViewModel) {
    val plat = vm.platform
    val diag = vm.diagnostics
    val health = vm.health

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(InkBackground)
    ) {
        // Header
        Surface(
            color = SurfacePanel,
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 12.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Column {
                    Text(
                        "System & Diagnostics",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                    Text(
                        "Real-time desktop telemetry & local models",
                        color = TextMuted,
                        fontSize = 11.sp
                    )
                }

                IconButton(onClick = { vm.refreshDiagnostics() }) {
                    Icon(Icons.Rounded.Refresh, contentDescription = "Refresh", tint = PrimaryBlue)
                }
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Server Status Card
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            "Server Runtime",
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary,
                            fontSize = 15.sp
                        )
                        StatusBadge(
                            text = if (health?.status == "ok") "ONLINE" else "DISCONNECTED",
                            color = if (health?.status == "ok") SecondaryTeal else DangerRed
                        )
                    }

                    HorizontalDivider(color = BorderColor)

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Server OS:", color = TextMuted, fontSize = 13.sp)
                        val osName = when {
                            plat?.isWindows == true -> "🪟 Windows (Native)"
                            plat?.isLinux == true -> "🐧 Linux (Debian/Ubuntu)"
                            else -> plat?.platform ?: "Linux"
                        }
                        Text(osName, color = TextPrimary, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Architecture:", color = TextMuted, fontSize = 13.sp)
                        Text(plat?.arch ?: "x64", color = TextPrimary, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Node.js Runtime:", color = TextMuted, fontSize = 13.sp)
                        Text(plat?.nodeVersion ?: "v22+", color = TextPrimary, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Uptime:", color = TextMuted, fontSize = 13.sp)
                        val uptimeSec = diag?.uptime ?: health?.uptime ?: 0.0
                        Text("${formatUptime(uptimeSec)}", color = TextPrimary, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Workspace Directory:", color = TextMuted, fontSize = 13.sp)
                        Text(
                            plat?.workspaceDir?.ifEmpty { "./data" } ?: "./data",
                            color = PrimaryBlue,
                            fontWeight = FontWeight.Medium,
                            fontSize = 12.sp
                        )
                    }
                }
            }

            // Installed Ollama Models Card
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text(
                            "Local LLM Catalog",
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary,
                            fontSize = 15.sp
                        )
                        Text(
                            "${vm.availableModels.size} Models",
                            color = PrimaryBlue,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.SemiBold
                        )
                    }

                    HorizontalDivider(color = BorderColor)

                    if (vm.availableModels.isEmpty()) {
                        Text(
                            "No local Ollama models detected or using default fallback.",
                            color = TextMuted,
                            fontSize = 13.sp,
                            modifier = Modifier.padding(vertical = 8.dp)
                        )
                    } else {
                        vm.availableModels.forEach { model ->
                            Surface(
                                color = SurfaceRaised,
                                shape = RoundedCornerShape(8.dp),
                                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor.copy(alpha = 0.5f)),
                                modifier = Modifier.fillMaxWidth()
                            ) {
                                Row(
                                    modifier = Modifier.padding(12.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column {
                                        Text(model.name, color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                                        val details = mutableListOf<String>()
                                        if (model.parameterSize != null) details.add(model.parameterSize)
                                        if (model.quantizationLevel != null) details.add(model.quantizationLevel)
                                        if (model.size != null) details.add(formatBytes(model.size))
                                        Text(details.joinToString(" • "), color = TextMuted, fontSize = 11.sp)
                                    }

                                    if (model.name == vm.selectedModel) {
                                        StatusBadge(text = "ACTIVE", color = SecondaryTeal)
                                    } else {
                                        TextButton(onClick = { vm.selectedModel = model.name }) {
                                            Text("Select", color = PrimaryBlue, fontSize = 12.sp)
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Diagnostics Event Stats Card
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Event & Trace Logs",
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary,
                        fontSize = 15.sp
                    )

                    HorizontalDivider(color = BorderColor)

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Total Logged Events:", color = TextMuted, fontSize = 13.sp)
                        Text("${diag?.logCount ?: 0}", color = TextPrimary, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Recorded Error Traces:", color = TextMuted, fontSize = 13.sp)
                        Text(
                            "${diag?.errorCount ?: 0}",
                            color = if ((diag?.errorCount ?: 0) > 0) AccentOrange else SecondaryTeal,
                            fontWeight = FontWeight.Bold,
                            fontSize = 13.sp
                        )
                    }
                }
            }
        }
    }
}

private fun formatUptime(seconds: Double): String {
    val sec = seconds.toLong()
    val hours = sec / 3600
    val minutes = (sec % 3600) / 60
    val s = sec % 60
    return if (hours > 0) "${hours}h ${minutes}m ${s}s" else "${minutes}m ${s}s"
}

private fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val exp = (Math.log(bytes.toDouble()) / Math.log(1024.0)).toInt()
    val pre = "KMGTPE"[exp - 1]
    return String.format(Locale.US, "%.1f %sB", bytes / Math.pow(1024.0, exp.toDouble()), pre)
}

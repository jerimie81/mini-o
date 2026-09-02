package com.minio.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.minio.mobile.ui.theme.*
import com.minio.mobile.viewmodel.MiniOViewModel

@Composable
fun DiagnosticsScreen(vm: MiniOViewModel) {
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
                        "System Diagnostics",
                        style = MaterialTheme.typography.titleMedium,
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary
                    )
                    Text(
                        "Real-time health, server load, and system environment",
                        color = TextMuted,
                        fontSize = 11.sp
                    )
                }

                IconButton(onClick = { vm.refreshDiagnostics() }) {
                    Icon(Icons.Rounded.Refresh, contentDescription = "Refresh Diagnostics", tint = PrimaryBlue)
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
            // Health Snapshot Card
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
                        Text("Server Health Status", fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 15.sp)
                        Badge(
                            containerColor = if (vm.health?.status == "ok") StatusGreen else DangerRed,
                            contentColor = TextPrimary
                        ) {
                            Text(vm.health?.status?.uppercase() ?: "UNKNOWN", modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp))
                        }
                    }

                    HorizontalDivider(color = BorderColor)

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Server Version:", color = TextMuted, fontSize = 13.sp)
                        Text(vm.health?.version ?: "--", color = TextPrimary, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Host Platform:", color = TextMuted, fontSize = 13.sp)
                        Text(vm.health?.platform ?: vm.platform?.platform ?: "--", color = TextPrimary, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Uptime:", color = TextMuted, fontSize = 13.sp)
                        Text("${vm.health?.uptime?.toInt() ?: 0} seconds", color = SecondaryTeal, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    }
                }
            }

            // Environment & Platform Info
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Environment & Workspace", fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 15.sp)
                    HorizontalDivider(color = BorderColor)

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Architecture:", color = TextMuted, fontSize = 13.sp)
                        Text(vm.platform?.arch ?: "--", color = TextPrimary, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Node Runtime:", color = TextMuted, fontSize = 13.sp)
                        Text(vm.platform?.nodeVersion ?: "--", color = TextPrimary, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Workspace Path:", color = TextMuted, fontSize = 13.sp)
                        Text(vm.platform?.workspaceDir ?: "--", color = PrimaryBlue, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                    }
                }
            }

            // Diagnostics Summary
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Activity Metrics", fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 15.sp)
                    HorizontalDivider(color = BorderColor)

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Active Log Entries:", color = TextMuted, fontSize = 13.sp)
                        Text("${vm.diagnostics?.logCount ?: 0}", color = TextPrimary, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Error Log Count:", color = TextMuted, fontSize = 13.sp)
                        Text("${vm.diagnostics?.errorCount ?: 0}", color = if ((vm.diagnostics?.errorCount ?: 0) > 0) DangerRed else TextPrimary, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Active Connections:", color = TextMuted, fontSize = 13.sp)
                        Text("${vm.diagnostics?.activeConnections ?: 1}", color = StatusGreen, fontSize = 13.sp)
                    }
                }
            }
        }
    }
}

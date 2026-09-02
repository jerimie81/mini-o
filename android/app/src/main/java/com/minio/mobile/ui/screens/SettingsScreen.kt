package com.minio.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.fragment.app.FragmentActivity
import com.minio.mobile.ui.theme.*
import com.minio.mobile.util.BiometricAuthManager
import com.minio.mobile.util.Formatters
import com.minio.mobile.viewmodel.MiniOViewModel

@Composable
fun SettingsScreen(vm: MiniOViewModel) {
    val context = LocalContext.current
    var showClearConfirm by remember { mutableStateOf(false) }
    var isTokenRevealed by remember { mutableStateOf(false) }

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
            Column(modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp)) {
                Text(
                    "Settings & Pairing",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Bold,
                    color = TextPrimary
                )
                Text(
                    "Manage your server connections, appearance, and local storage",
                    color = TextMuted,
                    fontSize = 11.sp
                )
            }
        }

        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(rememberScrollState())
                .padding(16.dp),
            verticalArrangement = Arrangement.spacedBy(16.dp)
        ) {
            // Active Connection Card
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Active Connection",
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary,
                        fontSize = 15.sp
                    )

                    HorizontalDivider(color = BorderColor)

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Server Endpoint:", color = TextMuted, fontSize = 13.sp)
                        Text(vm.connection?.url ?: "Not connected", color = PrimaryBlue, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    }

                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Text("Token Authentication:", color = TextMuted, fontSize = 13.sp)
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                if (vm.connection?.token?.isNotBlank() == true) {
                                    if (isTokenRevealed) vm.connection!!.token else Formatters.redactToken(vm.connection!!.token)
                                } else "None (LAN open)",
                                color = TextPrimary,
                                fontWeight = FontWeight.Medium,
                                fontSize = 13.sp
                            )
                            if (vm.connection?.token?.isNotBlank() == true) {
                                IconButton(onClick = {
                                    if (isTokenRevealed) {
                                        isTokenRevealed = false
                                    } else {
                                        val activity = context as? FragmentActivity
                                        if (activity != null) {
                                            val bio = BiometricAuthManager(context)
                                            bio.authenticate(
                                                activity = activity,
                                                title = "Reveal Server Token",
                                                subtitle = "Scan fingerprint to view unredacted bearer token",
                                                onSuccess = { isTokenRevealed = true },
                                                onError = { vm.showToast(it) }
                                            )
                                        } else {
                                            isTokenRevealed = true
                                        }
                                    }
                                }) {
                                    Icon(
                                        if (isTokenRevealed) Icons.Rounded.VisibilityOff else Icons.Rounded.Fingerprint,
                                        contentDescription = "Authenticate & Reveal Token",
                                        tint = SecondaryTeal
                                    )
                                }
                            }
                        }
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Last Connected:", color = TextMuted, fontSize = 13.sp)
                        Text(
                            if (vm.lastConnectionTime > 0) Formatters.formatMillis(vm.lastConnectionTime) else "Just now",
                            color = TextPrimary,
                            fontSize = 13.sp
                        )
                    }

                    Spacer(Modifier.height(4.dp))

                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                        OutlinedButton(
                            onClick = { vm.pingServer() },
                            modifier = Modifier.weight(1f),
                            shape = RoundedCornerShape(8.dp)
                        ) {
                            Icon(Icons.Rounded.Sensors, contentDescription = "Ping", modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Ping Test")
                        }

                        Button(
                            onClick = { vm.disconnect() },
                            colors = ButtonDefaults.buttonColors(containerColor = DangerRed.copy(alpha = 0.2f)),
                            border = androidx.compose.foundation.BorderStroke(1.dp, DangerRed.copy(alpha = 0.5f)),
                            shape = RoundedCornerShape(8.dp),
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(Icons.Rounded.Logout, contentDescription = "Disconnect", tint = DangerRed, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Disconnect", color = DangerRed, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }

            // Saved Server Profiles
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Saved Profiles (${vm.connectionProfiles.size})",
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary,
                        fontSize = 15.sp
                    )

                    HorizontalDivider(color = BorderColor)

                    if (vm.connectionProfiles.isEmpty()) {
                        Text("No saved connection profiles.", color = TextMuted, fontSize = 12.sp)
                    } else {
                        vm.connectionProfiles.forEach { profile ->
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Column {
                                    Text(profile.name, fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 13.sp)
                                    Text(profile.url, color = TextMuted, fontSize = 11.sp)
                                }

                                IconButton(onClick = { vm.forgetServer(profile.id) }) {
                                    Icon(Icons.Rounded.DeleteOutline, contentDescription = "Remove Profile", tint = DangerRed)
                                }
                            }
                        }
                    }
                }
            }

            // Appearance & Model Defaults
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Preferences & Models",
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary,
                        fontSize = 15.sp
                    )

                    HorizontalDivider(color = BorderColor)

                    Text("Active Model:", color = TextMuted, fontSize = 13.sp)
                    Text(vm.selectedModel, color = SecondaryTeal, fontWeight = FontWeight.Bold, fontSize = 13.sp)

                    Spacer(Modifier.height(4.dp))

                    Text("App Theme:", color = TextMuted, fontSize = 13.sp)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        FilterChip(
                            selected = vm.themeMode == "SYSTEM",
                            onClick = { vm.setTheme("SYSTEM") },
                            label = { Text("System") }
                        )
                        FilterChip(
                            selected = vm.themeMode == "DARK",
                            onClick = { vm.setTheme("DARK") },
                            label = { Text("Dark") }
                        )
                        FilterChip(
                            selected = vm.themeMode == "LIGHT",
                            onClick = { vm.setTheme("LIGHT") },
                            label = { Text("Light") }
                        )
                    }
                }
            }

            // Data Management
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "Data & Security",
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary,
                        fontSize = 15.sp
                    )

                    HorizontalDivider(color = BorderColor)

                    Button(
                        onClick = { showClearConfirm = true },
                        colors = ButtonDefaults.buttonColors(containerColor = DangerRed.copy(alpha = 0.2f)),
                        border = androidx.compose.foundation.BorderStroke(1.dp, DangerRed.copy(alpha = 0.5f)),
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(Icons.Rounded.CleaningServices, contentDescription = null, tint = DangerRed, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Wipe Saved Profiles & Chat History", color = DangerRed, fontWeight = FontWeight.Bold, fontSize = 13.sp)
                    }
                }
            }

            // About Mini-O Companion
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text(
                        "About Mini-O Mobile",
                        fontWeight = FontWeight.Bold,
                        color = TextPrimary,
                        fontSize = 15.sp
                    )

                    HorizontalDivider(color = BorderColor)

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Companion Version:", color = TextMuted, fontSize = 13.sp)
                        Text("1.0.0 (Production)", color = TextPrimary, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    }

                    Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Security Standard:", color = TextMuted, fontSize = 13.sp)
                        Text("EncryptedSharedPreferences (AES-256)", color = SecondaryTeal, fontWeight = FontWeight.Medium, fontSize = 13.sp)
                    }
                }
            }
        }
    }

    if (showClearConfirm) {
        AlertDialog(
            onDismissRequest = { showClearConfirm = false },
            title = { Text("Wipe Local Data?") },
            text = { Text("This will permanently remove all saved server connection profiles, tokens, and cached chat thread history on this device.") },
            confirmButton = {
                Button(
                    onClick = {
                        showClearConfirm = false
                        vm.clearLocalData()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DangerRed)
                ) {
                    Text("Wipe All Data")
                }
            },
            dismissButton = {
                TextButton(onClick = { showClearConfirm = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

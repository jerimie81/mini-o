package com.minio.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowForward
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.minio.mobile.ui.theme.*
import com.minio.mobile.util.DiscoveredServer
import com.minio.mobile.viewmodel.MiniOViewModel

@Composable
fun ConnectScreen(
    url: String,
    onUrlChange: (String) -> Unit,
    token: String,
    onTokenChange: (String) -> Unit,
    name: String,
    onNameChange: (String) -> Unit,
    isLoading: Boolean,
    errorMessage: String?,
    onConnect: () -> Unit,
    vm: MiniOViewModel? = null
) {
    val context = LocalContext.current
    val clipboardManager = LocalClipboardManager.current
    var showPassword by remember { mutableStateOf(false) }
    var showQrPasteDialog by remember { mutableStateOf(false) }
    var qrInput by remember { mutableStateOf("") }
    val isNonLanHttp = url.startsWith("http://") && !url.contains("192.168.") && !url.contains("10.0.2.2") && !url.contains("127.0.0.1") && !url.contains("localhost")

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(InkBackground)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp, vertical = 36.dp),
        verticalArrangement = Arrangement.Center
    ) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .background(PrimaryBlue, RoundedCornerShape(2.dp))
            )
            Text(
                "MINI-O AI WORKSPACE",
                color = PrimaryBlue,
                style = MaterialTheme.typography.labelMedium,
                fontWeight = FontWeight.Bold,
                letterSpacing = 1.2.sp
            )
        }

        Spacer(Modifier.height(16.dp))

        Text(
            "Your local AI,\nwherever you are.",
            style = MaterialTheme.typography.headlineLarge,
            fontWeight = FontWeight.Bold,
            color = TextPrimary,
            lineHeight = 40.sp
        )

        Spacer(Modifier.height(12.dp))

        Text(
            "Connect securely to your Mini-O server running on Windows or Linux to chat, manage workspace files, and run local models.",
            color = TextMuted,
            style = MaterialTheme.typography.bodyMedium,
            lineHeight = 22.sp
        )

        Spacer(Modifier.height(20.dp))

        // LAN Wi-Fi Auto Scanner & QR Code Import Section
        if (vm != null) {
            Card(
                colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                shape = RoundedCornerShape(12.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Column(modifier = Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceBetween,
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Icon(Icons.Rounded.Wifi, contentDescription = null, tint = SecondaryTeal, modifier = Modifier.size(18.dp))
                            Text("Zero-Config & WiFi Discovery", fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 13.sp)
                        }

                        Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                            IconButton(onClick = { showQrPasteDialog = true }) {
                                Icon(Icons.Rounded.QrCodeScanner, contentDescription = "QR Code Import", tint = PrimaryBlue)
                            }

                            if (vm.isScanningLan) {
                                TextButton(onClick = { vm.stopLanScan() }) {
                                    Text("Stop", color = DangerRed, fontSize = 11.sp)
                                }
                            } else {
                                Button(
                                    onClick = { vm.scanLanServers(context) },
                                    shape = RoundedCornerShape(8.dp),
                                    colors = ButtonDefaults.buttonColors(containerColor = SecondaryTeal, contentColor = Color(0xFF002A24))
                                ) {
                                    Icon(Icons.Rounded.Radar, contentDescription = null, modifier = Modifier.size(14.dp))
                                    Spacer(Modifier.width(4.dp))
                                    Text("Scan WiFi", fontSize = 11.sp, fontWeight = FontWeight.Bold)
                                }
                            }
                        }
                    }

                    if (vm.isScanningLan) {
                        LinearProgressIndicator(
                            progress = { vm.scanProgress },
                            modifier = Modifier.fillMaxWidth().height(4.dp),
                            color = SecondaryTeal
                        )
                        Text("Scanning subnet & mDNS _mini-o._tcp.local...", color = TextMuted, fontSize = 10.sp)
                    }

                    if (vm.discoveredServers.isNotEmpty()) {
                        Spacer(Modifier.height(4.dp))
                        Text("Discovered Host PCs (${vm.discoveredServers.size}):", color = TextSecondary, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                        vm.discoveredServers.forEach { server ->
                            Surface(
                                color = SurfaceRaised,
                                shape = RoundedCornerShape(8.dp),
                                border = androidx.compose.foundation.BorderStroke(1.dp, SecondaryTeal.copy(alpha = 0.4f)),
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        onUrlChange(server.url)
                                        onNameChange(server.name)
                                    }
                            ) {
                                Row(
                                    modifier = Modifier.padding(10.dp),
                                    horizontalArrangement = Arrangement.SpaceBetween,
                                    verticalAlignment = Alignment.CenterVertically
                                ) {
                                    Column {
                                        Text(server.name, fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 12.sp)
                                        Text(server.url, color = SecondaryTeal, fontSize = 11.sp)
                                    }
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                                        Badge(containerColor = StatusGreen.copy(alpha = 0.2f), contentColor = StatusGreen) {
                                            Text("${server.latencyMs}ms", fontSize = 10.sp, modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp))
                                        }
                                        Icon(Icons.Rounded.ChevronRight, contentDescription = "Use URL", tint = TextMuted)
                                    }
                                }
                            }
                        }
                    }
                }
            }

            Spacer(Modifier.height(16.dp))
        }

        // Quick Preset Chips
        Text(
            "Quick Connection Presets:",
            color = TextSecondary,
            fontSize = 12.sp,
            fontWeight = FontWeight.Medium
        )
        Spacer(Modifier.height(8.dp))
        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            SuggestionChip(
                onClick = { onUrlChange("http://10.0.2.2:3000") },
                label = { Text("Emulator (10.0.2.2)") },
                colors = SuggestionChipDefaults.suggestionChipColors(
                    containerColor = SurfaceRaised,
                    labelColor = TextSecondary
                )
            )
            SuggestionChip(
                onClick = { onUrlChange("http://127.0.0.1:3000") },
                label = { Text("Localhost") },
                colors = SuggestionChipDefaults.suggestionChipColors(
                    containerColor = SurfaceRaised,
                    labelColor = TextSecondary
                )
            )
        }

        Spacer(Modifier.height(16.dp))

        OutlinedTextField(
            value = name,
            onValueChange = onNameChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Profile Name") },
            placeholder = { Text("Home PC") },
            singleLine = true,
            leadingIcon = { Icon(Icons.Rounded.Badge, contentDescription = "Profile Name", tint = PrimaryBlue) },
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = PrimaryBlue,
                unfocusedBorderColor = BorderColor,
                focusedContainerColor = SurfacePanel,
                unfocusedContainerColor = SurfacePanel,
                focusedTextColor = TextPrimary,
                unfocusedTextColor = TextPrimary
            ),
            shape = RoundedCornerShape(12.dp)
        )

        Spacer(Modifier.height(14.dp))

        OutlinedTextField(
            value = url,
            onValueChange = onUrlChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Server URL") },
            placeholder = { Text("http://192.168.1.50:3000") },
            singleLine = true,
            leadingIcon = { Icon(Icons.Rounded.Dns, contentDescription = "Server URL", tint = PrimaryBlue) },
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = PrimaryBlue,
                unfocusedBorderColor = BorderColor,
                focusedContainerColor = SurfacePanel,
                unfocusedContainerColor = SurfacePanel,
                focusedTextColor = TextPrimary,
                unfocusedTextColor = TextPrimary
            ),
            shape = RoundedCornerShape(12.dp)
        )

        if (isNonLanHttp) {
            Spacer(Modifier.height(8.dp))
            Text(
                "⚠️ Warning: Unencrypted HTTP over non-LAN address may expose credentials.",
                color = AccentOrange,
                fontSize = 11.sp
            )
        }

        Spacer(Modifier.height(14.dp))

        OutlinedTextField(
            value = token,
            onValueChange = onTokenChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Bearer Token") },
            placeholder = { Text("Enter security token") },
            singleLine = true,
            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
            leadingIcon = { Icon(Icons.Rounded.Key, contentDescription = "Token", tint = SecondaryTeal) },
            trailingIcon = {
                IconButton(onClick = { showPassword = !showPassword }) {
                    Icon(
                        if (showPassword) Icons.Rounded.VisibilityOff else Icons.Rounded.Visibility,
                        contentDescription = "Toggle token visibility",
                        tint = TextMuted
                    )
                }
            },
            colors = OutlinedTextFieldDefaults.colors(
                focusedBorderColor = PrimaryBlue,
                unfocusedBorderColor = BorderColor,
                focusedContainerColor = SurfacePanel,
                unfocusedContainerColor = SurfacePanel,
                focusedTextColor = TextPrimary,
                unfocusedTextColor = TextPrimary
            ),
            shape = RoundedCornerShape(12.dp)
        )

        if (errorMessage != null) {
            Spacer(Modifier.height(14.dp))
            Card(
                colors = CardDefaults.cardColors(containerColor = DangerRed.copy(alpha = 0.15f)),
                border = androidx.compose.foundation.BorderStroke(1.dp, DangerRed.copy(alpha = 0.4f)),
                shape = RoundedCornerShape(8.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(12.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = DangerRed, modifier = Modifier.size(18.dp))
                    Text(errorMessage, color = DangerRed, fontSize = 13.sp)
                }
            }
        }

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = onConnect,
            modifier = Modifier
                .fillMaxWidth()
                .height(52.dp),
            enabled = !isLoading && url.isNotBlank(),
            shape = RoundedCornerShape(14.dp),
            colors = ButtonDefaults.buttonColors(
                containerColor = PrimaryBlue,
                contentColor = Color(0xFF001A4E),
                disabledContainerColor = SurfaceRaised,
                disabledContentColor = TextMuted
            )
        ) {
            if (isLoading) {
                CircularProgressIndicator(modifier = Modifier.size(22.dp), strokeWidth = 2.5.dp, color = TextPrimary)
            } else {
                Text("Connect to Mini-O", fontWeight = FontWeight.Bold, fontSize = 15.sp)
                Spacer(Modifier.width(8.dp))
                Icon(Icons.AutoMirrored.Rounded.ArrowForward, contentDescription = null, modifier = Modifier.size(18.dp))
            }
        }

        Spacer(Modifier.height(24.dp))

        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
            modifier = Modifier.fillMaxWidth()
        ) {
            Icon(Icons.Rounded.Lock, contentDescription = null, tint = TextMuted, modifier = Modifier.size(16.dp))
            Text(
                "Credentials encrypted with Android Keystore AES-256 GCM.",
                color = TextMuted,
                style = MaterialTheme.typography.labelSmall
            )
        }
    }

    if (showQrPasteDialog) {
        AlertDialog(
            onDismissRequest = { showQrPasteDialog = false },
            title = { Text("Import QR Pairing Payload") },
            text = {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Paste JSON or scan pairing payload string from desktop:", fontSize = 12.sp, color = TextMuted)
                    OutlinedTextField(
                        value = qrInput,
                        onValueChange = { qrInput = it },
                        placeholder = { Text("""{"url":"http://192.168.1.50:3000","token":"secret"}""") },
                        modifier = Modifier.fillMaxWidth(),
                        maxLines = 4
                    )
                    Button(
                        onClick = {
                            val clipText = clipboardManager.getText()?.text
                            if (!clipText.isNullOrBlank()) {
                                qrInput = clipText
                            }
                        },
                        colors = ButtonDefaults.buttonColors(containerColor = SurfaceRaised)
                    ) {
                        Icon(Icons.Rounded.ContentPaste, contentDescription = null, modifier = Modifier.size(14.dp))
                        Spacer(Modifier.width(4.dp))
                        Text("Paste from Clipboard", fontSize = 11.sp)
                    }
                }
            },
            confirmButton = {
                Button(onClick = {
                    showQrPasteDialog = false
                    if (qrInput.isNotBlank() && vm != null) {
                        vm.parseAndApplyQrPayload(qrInput) { profile ->
                            onUrlChange(profile.url)
                            onTokenChange(profile.token)
                            onNameChange(profile.name)
                        }
                    }
                }) {
                    Text("Apply Pairing")
                }
            },
            dismissButton = {
                TextButton(onClick = { showQrPasteDialog = false }) { Text("Cancel") }
            }
        )
    }
}

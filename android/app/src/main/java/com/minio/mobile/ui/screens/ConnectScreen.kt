package com.minio.mobile.ui.screens

import androidx.compose.foundation.background
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
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.minio.mobile.ui.theme.*

@Composable
fun ConnectScreen(
    url: String,
    onUrlChange: (String) -> Unit,
    token: String,
    onTokenChange: (String) -> Unit,
    isLoading: Boolean,
    errorMessage: String?,
    onConnect: () -> Unit
) {
    var showPassword by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(InkBackground)
            .verticalScroll(rememberScrollState())
            .padding(horizontal = 28.dp, vertical = 40.dp),
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

        Spacer(Modifier.height(32.dp))

        // Quick Preset Chips
        Text(
            "Quick LAN Presets:",
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
            value = url,
            onValueChange = onUrlChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Server URL") },
            placeholder = { Text("http://192.168.1.50:3000") },
            singleLine = true,
            leadingIcon = { Icon(Icons.Rounded.Dns, contentDescription = null, tint = PrimaryBlue) },
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
            value = token,
            onValueChange = onTokenChange,
            modifier = Modifier.fillMaxWidth(),
            label = { Text("Bearer Token (Optional on Localhost)") },
            placeholder = { Text("Enter security token if configured") },
            singleLine = true,
            visualTransformation = if (showPassword) VisualTransformation.None else PasswordVisualTransformation(),
            leadingIcon = { Icon(Icons.Rounded.Key, contentDescription = null, tint = SecondaryTeal) },
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

        Spacer(Modifier.height(28.dp))

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
}

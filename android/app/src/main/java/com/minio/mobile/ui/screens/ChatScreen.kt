package com.minio.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.Send
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.minio.mobile.data.ChatMessage
import com.minio.mobile.ui.theme.*
import com.minio.mobile.viewmodel.MiniOViewModel
import kotlinx.coroutines.launch

@Composable
fun ChatScreen(vm: MiniOViewModel) {
    val listState = rememberLazyListState()
    val coroutineScope = rememberCoroutineScope()
    var showModelMenu by remember { mutableStateOf(false) }

    LaunchedEffect(vm.chatMessages.size, vm.chatMessages.lastOrNull()?.content) {
        if (vm.chatMessages.isNotEmpty()) {
            listState.animateScrollToItem(vm.chatMessages.size - 1)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(InkBackground)
    ) {
        // Header Bar
        Surface(
            color = SurfacePanel,
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 10.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    Box(
                        modifier = Modifier
                            .size(8.dp)
                            .clip(CircleShape)
                            .background(if (vm.isConnected) StatusGreen else DangerRed)
                    )
                    Column {
                        Text(
                            "Mini-O AI Workspace",
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary,
                            fontSize = 14.sp
                        )
                        Text(
                            if (vm.isConnected) "Connected: ${vm.connection?.url}" else "Disconnected",
                            color = TextMuted,
                            fontSize = 11.sp
                        )
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    // Model Dropdown Selector
                    Box {
                        AssistChip(
                            onClick = { showModelMenu = true },
                            label = { Text(vm.selectedModel.take(16), fontSize = 11.sp) },
                            leadingIcon = { Icon(Icons.Rounded.Memory, contentDescription = "Model", modifier = Modifier.size(14.dp)) },
                            colors = AssistChipDefaults.assistChipColors(labelColor = SecondaryTeal)
                        )
                        DropdownMenu(
                            expanded = showModelMenu,
                            onDismissRequest = { showModelMenu = false }
                        ) {
                            vm.availableModels.forEach { model ->
                                DropdownMenuItem(
                                    text = { Text(model.name) },
                                    onClick = {
                                        vm.selectModel(model.name)
                                        showModelMenu = false
                                    }
                                )
                            }
                        }
                    }

                    IconButton(onClick = { vm.createNewThread() }) {
                        Icon(Icons.Rounded.AddComment, contentDescription = "New Thread", tint = PrimaryBlue)
                    }

                    IconButton(onClick = { vm.clearChat() }) {
                        Icon(Icons.Rounded.DeleteSweep, contentDescription = "Clear Chat", tint = TextMuted)
                    }
                }
            }
        }

        // Active Tool / Stream Banner
        if (vm.activeToolNotification != null) {
            Surface(
                color = SurfaceRaised,
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    CircularProgressIndicator(modifier = Modifier.size(12.dp), strokeWidth = 1.5.dp, color = PrimaryBlue)
                    Spacer(Modifier.width(8.dp))
                    Text(vm.activeToolNotification!!, color = PrimaryBlue, fontSize = 12.sp, fontWeight = FontWeight.Medium)
                }
            }
        }

        if (vm.isChatStreaming && vm.tokensPerSec > 0) {
            Text(
                "Streaming speed: ${String.format("%.1f", vm.tokensPerSec)} tokens/sec",
                color = TextMuted,
                fontSize = 10.sp,
                modifier = Modifier.padding(start = 16.dp, top = 4.dp)
            )
        }

        // Message List
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 14.dp),
            contentPadding = PaddingValues(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            items(vm.chatMessages, key = { it.id }) { msg ->
                ChatMessageBubble(
                    message = msg,
                    onRegenerate = if (msg == vm.chatMessages.lastOrNull { it.role == "assistant" }) {
                        { vm.regenerateLastResponse() }
                    } else null,
                    onDelete = { vm.deleteChatMessage(msg.id) }
                )
            }
        }

        // Input Bar
        Surface(
            color = SurfacePanel,
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .padding(12.dp)
                    .fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = vm.chatInput,
                    onValueChange = { vm.chatInput = it },
                    placeholder = { Text("Ask Mini-O or request a workspace task...", fontSize = 13.sp) },
                    modifier = Modifier.weight(1f),
                    shape = RoundedCornerShape(20.dp),
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PrimaryBlue,
                        unfocusedBorderColor = BorderColor,
                        focusedContainerColor = InkBackground,
                        unfocusedContainerColor = InkBackground,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary
                    ),
                    maxLines = 4
                )

                if (vm.isChatStreaming) {
                    IconButton(
                        onClick = { vm.stopChatGeneration() },
                        modifier = Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(DangerRed)
                    ) {
                        Icon(Icons.Rounded.Stop, contentDescription = "Stop", tint = Color.White)
                    }
                } else {
                    IconButton(
                        onClick = { vm.sendChatMessage() },
                        enabled = vm.chatInput.isNotBlank(),
                        modifier = Modifier
                            .size(44.dp)
                            .clip(CircleShape)
                            .background(if (vm.chatInput.isNotBlank()) PrimaryBlue else SurfaceRaised)
                    ) {
                        Icon(
                            Icons.AutoMirrored.Rounded.Send,
                            contentDescription = "Send",
                            tint = if (vm.chatInput.isNotBlank()) Color(0xFF001A4E) else TextMuted
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ChatMessageBubble(
    message: ChatMessage,
    onRegenerate: (() -> Unit)?,
    onDelete: () -> Unit
) {
    val isUser = message.role == "user"

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        Card(
            colors = CardDefaults.cardColors(
                containerColor = if (isUser) PrimaryBlue.copy(alpha = 0.2f) else SurfacePanel
            ),
            border = androidx.compose.foundation.BorderStroke(
                1.dp,
                if (isUser) PrimaryBlue.copy(alpha = 0.4f) else BorderColor
            ),
            shape = RoundedCornerShape(14.dp),
            modifier = Modifier.widthIn(max = 300.dp)
        ) {
            Column(modifier = Modifier.padding(12.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        if (isUser) "You" else "Mini-O Assistant",
                        fontWeight = FontWeight.Bold,
                        color = if (isUser) PrimaryBlue else SecondaryTeal,
                        fontSize = 11.sp
                    )

                    Row {
                        if (onRegenerate != null) {
                            IconButton(onClick = onRegenerate, modifier = Modifier.size(20.dp)) {
                                Icon(Icons.Rounded.Refresh, contentDescription = "Regenerate", tint = TextMuted, modifier = Modifier.size(14.dp))
                            }
                        }
                        IconButton(onClick = onDelete, modifier = Modifier.size(20.dp)) {
                            Icon(Icons.Rounded.Close, contentDescription = "Delete Message", tint = TextMuted, modifier = Modifier.size(14.dp))
                        }
                    }
                }

                Spacer(Modifier.height(6.dp))

                Text(
                    text = message.content.ifEmpty { "Thinking..." },
                    color = TextPrimary,
                    fontSize = 13.sp,
                    lineHeight = 18.sp
                )

                if (message.isStreaming) {
                    Spacer(Modifier.height(4.dp))
                    LinearProgressIndicator(
                        modifier = Modifier.fillMaxWidth().height(2.dp),
                        color = PrimaryBlue
                    )
                }
            }
        }
    }
}

package com.minio.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
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
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.minio.mobile.data.ChatMessage
import com.minio.mobile.ui.components.SimpleMarkdownView
import com.minio.mobile.ui.components.StatusBadge
import com.minio.mobile.ui.theme.*
import com.minio.mobile.viewmodel.MiniOViewModel
import kotlinx.coroutines.launch

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(vm: MiniOViewModel) {
    val listState = rememberLazyListState()
    val scope = rememberCoroutineScope()
    var isModelMenuExpanded by remember { mutableStateOf(false) }

    val quickPrompts = listOf(
        "List workspace files",
        "Read AGENT.md",
        "Check system health",
        "Summarize project status"
    )

    LaunchedEffect(vm.chatMessages.size, vm.chatMessages.lastOrNull()?.content?.length) {
        if (vm.chatMessages.isNotEmpty()) {
            listState.animateScrollToItem(vm.chatMessages.size - 1)
        }
    }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(InkBackground)
    ) {
        // Header Bar with Model Selector & Quick Actions
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
                // Model Dropdown
                Box {
                    Surface(
                        color = SurfaceRaised,
                        shape = RoundedCornerShape(20.dp),
                        border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                        modifier = Modifier.clickable { isModelMenuExpanded = true }
                    ) {
                        Row(
                            modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                            verticalAlignment = Alignment.CenterVertically,
                            horizontalArrangement = Arrangement.spacedBy(6.dp)
                        ) {
                            Box(
                                modifier = Modifier
                                    .size(8.dp)
                                    .clip(CircleShape)
                                    .background(SecondaryTeal)
                            )
                            Text(
                                text = vm.selectedModel,
                                color = TextPrimary,
                                fontSize = 13.sp,
                                fontWeight = FontWeight.SemiBold
                            )
                            Icon(
                                Icons.Rounded.ArrowDropDown,
                                contentDescription = "Select Model",
                                tint = TextMuted,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    DropdownMenu(
                        expanded = isModelMenuExpanded,
                        onDismissRequest = { isModelMenuExpanded = false },
                        modifier = Modifier.background(SurfaceRaised)
                    ) {
                        if (vm.availableModels.isEmpty()) {
                            DropdownMenuItem(
                                text = { Text("minimax-m3:cloud (Default)", color = TextPrimary) },
                                onClick = {
                                    vm.selectedModel = "minimax-m3:cloud"
                                    isModelMenuExpanded = false
                                }
                            )
                        } else {
                            vm.availableModels.forEach { model ->
                                DropdownMenuItem(
                                    text = {
                                        Column {
                                            Text(model.name, color = TextPrimary, fontWeight = FontWeight.Medium)
                                            if (model.parameterSize != null) {
                                                Text(
                                                    "${model.parameterSize} • ${model.quantizationLevel ?: ""}",
                                                    color = TextMuted,
                                                    fontSize = 11.sp
                                                )
                                            }
                                        }
                                    },
                                    onClick = {
                                        vm.selectedModel = model.name
                                        isModelMenuExpanded = false
                                    }
                                )
                            }
                        }
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconButton(
                        onClick = { vm.clearChat() },
                        modifier = Modifier.size(36.dp)
                    ) {
                        Icon(
                            Icons.Rounded.DeleteOutline,
                            contentDescription = "Clear Chat",
                            tint = TextMuted,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }
        }

        // Active Tool / Notification Pill
        if (vm.activeToolNotification != null) {
            Surface(
                color = AccentOrange.copy(alpha = 0.15f),
                border = androidx.compose.foundation.BorderStroke(1.dp, AccentOrange.copy(alpha = 0.4f)),
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 6.dp),
                shape = RoundedCornerShape(8.dp)
            ) {
                Row(
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(12.dp),
                        strokeWidth = 2.dp,
                        color = AccentOrange
                    )
                    Text(
                        text = vm.activeToolNotification!!,
                        color = AccentOrange,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Medium
                    )
                }
            }
        }

        // Chat Message List
        LazyColumn(
            state = listState,
            modifier = Modifier
                .weight(1f)
                .fillMaxWidth()
                .padding(horizontal = 14.dp),
            contentPadding = PaddingValues(vertical = 12.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp)
        ) {
            items(vm.chatMessages, key = { it.id }) { message ->
                ChatMessageItem(message = message)
            }
        }

        // Quick Suggestion Chips (when idle)
        if (!vm.isChatStreaming) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .horizontalScroll(rememberScrollState())
                    .padding(horizontal = 14.dp, vertical = 4.dp),
                horizontalArrangement = Arrangement.spacedBy(6.dp)
            ) {
                quickPrompts.forEach { prompt ->
                    SuggestionChip(
                        onClick = { vm.sendChatMessage(prompt) },
                        label = { Text(prompt, fontSize = 12.sp) },
                        colors = SuggestionChipDefaults.suggestionChipColors(
                            containerColor = SurfaceRaised,
                            labelColor = TextSecondary
                        ),
                        border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                        shape = RoundedCornerShape(16.dp)
                    )
                }
            }
        }

        // Bottom Chat Input Bar
        Surface(
            color = SurfacePanel,
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 12.dp, vertical = 10.dp),
                verticalAlignment = Alignment.Bottom,
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                OutlinedTextField(
                    value = vm.chatInput,
                    onValueChange = { vm.chatInput = it },
                    modifier = Modifier.weight(1f),
                    placeholder = { Text("Ask Mini-O or request a task...", color = TextMuted, fontSize = 14.sp) },
                    maxLines = 5,
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PrimaryBlue,
                        unfocusedBorderColor = BorderColor,
                        focusedContainerColor = SurfaceRaised,
                        unfocusedContainerColor = SurfaceRaised,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary
                    ),
                    shape = RoundedCornerShape(20.dp)
                )

                if (vm.isChatStreaming) {
                    FilledIconButton(
                        onClick = { vm.stopChatGeneration() },
                        colors = IconButtonDefaults.filledIconButtonColors(containerColor = DangerRed),
                        modifier = Modifier.size(46.dp)
                    ) {
                        Icon(
                            Icons.Rounded.Stop,
                            contentDescription = "Stop generation",
                            tint = Color.White,
                            modifier = Modifier.size(22.dp)
                        )
                    }
                } else {
                    FilledIconButton(
                        onClick = { vm.sendChatMessage() },
                        enabled = vm.chatInput.isNotBlank(),
                        colors = IconButtonDefaults.filledIconButtonColors(
                            containerColor = PrimaryBlue,
                            disabledContainerColor = SurfaceRaised
                        ),
                        modifier = Modifier.size(46.dp)
                    ) {
                        Icon(
                            Icons.AutoMirrored.Rounded.Send,
                            contentDescription = "Send",
                            tint = if (vm.chatInput.isNotBlank()) Color(0xFF001A4E) else TextMuted,
                            modifier = Modifier.size(20.dp)
                        )
                    }
                }
            }
        }
    }
}

@Composable
fun ChatMessageItem(message: ChatMessage) {
    val isUser = message.role == "user"
    val clipboardManager = LocalClipboardManager.current

    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = if (isUser) Arrangement.End else Arrangement.Start
    ) {
        if (!isUser) {
            Box(
                modifier = Modifier
                    .size(28.dp)
                    .clip(CircleShape)
                    .background(PrimaryBlue.copy(alpha = 0.2f)),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    Icons.Rounded.AutoAwesome,
                    contentDescription = "Assistant",
                    tint = PrimaryBlue,
                    modifier = Modifier.size(16.dp)
                )
            }
            Spacer(Modifier.width(8.dp))
        }

        Surface(
            color = if (isUser) SurfaceRaised else SurfacePanel,
            shape = RoundedCornerShape(
                topStart = 16.dp,
                topEnd = 16.dp,
                bottomStart = if (isUser) 16.dp else 4.dp,
                bottomEnd = if (isUser) 4.dp else 16.dp
            ),
            border = androidx.compose.foundation.BorderStroke(
                1.dp,
                if (isUser) PrimaryBlue.copy(alpha = 0.3f) else BorderColor
            ),
            modifier = Modifier.widthIn(max = 320.dp)
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = if (isUser) "You" else "Mini-O",
                        color = if (isUser) PrimaryBlue else SecondaryTeal,
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp
                    )

                    IconButton(
                        onClick = { clipboardManager.setText(AnnotatedString(message.content)) },
                        modifier = Modifier.size(20.dp)
                    ) {
                        Icon(
                            Icons.Rounded.ContentCopy,
                            contentDescription = "Copy text",
                            tint = TextMuted,
                            modifier = Modifier.size(12.dp)
                        )
                    }
                }

                Spacer(Modifier.height(6.dp))

                if (message.content.isEmpty() && message.isStreaming) {
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(12.dp),
                            strokeWidth = 2.dp,
                            color = PrimaryBlue
                        )
                        Text(
                            "Thinking...",
                            color = TextMuted,
                            fontSize = 13.sp
                        )
                    }
                } else {
                    SimpleMarkdownView(text = message.content)
                }

                if (message.isStreaming && message.content.isNotEmpty()) {
                    Box(
                        modifier = Modifier
                            .padding(top = 4.dp)
                            .size(6.dp, 14.dp)
                            .background(PrimaryBlue)
                    )
                }
            }
        }
    }
}

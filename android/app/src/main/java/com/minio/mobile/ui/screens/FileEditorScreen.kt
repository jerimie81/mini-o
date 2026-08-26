package com.minio.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.minio.mobile.ui.components.SimpleMarkdownView
import com.minio.mobile.ui.theme.*
import com.minio.mobile.viewmodel.MiniOViewModel

@Composable
fun FileEditorScreen(vm: MiniOViewModel) {
    val filePath = vm.activeFilePath ?: return
    val isDirty = vm.editorText != vm.editorOriginalContent
    var isPreviewMode by remember { mutableStateOf(false) }

    val quickSymbols = listOf("  ", "#", "##", "```", "-", "*", ">", "`", "[", "]", "(", ")", "{", "}", "\"", "=", ":")

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(InkBackground)
    ) {
        // Editor Header Bar
        Surface(
            color = SurfacePanel,
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
            modifier = Modifier.fillMaxWidth()
        ) {
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 10.dp, vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(
                    onClick = { vm.closeEditor() },
                    modifier = Modifier.size(36.dp)
                ) {
                    Icon(
                        Icons.AutoMirrored.Rounded.ArrowBack,
                        contentDescription = "Close",
                        tint = TextPrimary,
                        modifier = Modifier.size(20.dp)
                    )
                }

                Column(
                    modifier = Modifier
                        .weight(1f)
                        .padding(horizontal = 6.dp)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        Text(
                            text = filePath.substringAfterLast('/'),
                            color = TextPrimary,
                            fontWeight = FontWeight.Bold,
                            fontSize = 14.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                        if (isDirty) {
                            Surface(
                                color = AccentOrange.copy(alpha = 0.2f),
                                shape = RoundedCornerShape(4.dp)
                            ) {
                                Text(
                                    "Unsaved",
                                    color = AccentOrange,
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    modifier = Modifier.padding(horizontal = 4.dp, vertical = 2.dp)
                                )
                            }
                        }
                    }
                    Text(
                        text = filePath,
                        color = TextMuted,
                        fontSize = 11.sp,
                        maxLines = 1,
                        overflow = TextOverflow.Ellipsis
                    )
                }

                // Action Buttons
                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    if (filePath.endsWith(".md", ignoreCase = true)) {
                        IconButton(
                            onClick = { isPreviewMode = !isPreviewMode },
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                if (isPreviewMode) Icons.Rounded.Edit else Icons.Rounded.Visibility,
                                contentDescription = "Toggle Preview",
                                tint = if (isPreviewMode) PrimaryBlue else TextMuted,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    if (isDirty) {
                        IconButton(
                            onClick = { vm.revertEditorChanges() },
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                Icons.Rounded.Undo,
                                contentDescription = "Revert",
                                tint = DangerRed,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    Button(
                        onClick = { vm.saveEditorFile() },
                        enabled = isDirty && !vm.isSavingFile,
                        colors = ButtonDefaults.buttonColors(
                            containerColor = PrimaryBlue,
                            disabledContainerColor = SurfaceRaised
                        ),
                        shape = RoundedCornerShape(8.dp),
                        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp),
                        modifier = Modifier.height(36.dp)
                    ) {
                        if (vm.isSavingFile) {
                            CircularProgressIndicator(modifier = Modifier.size(14.dp), strokeWidth = 2.dp, color = Color.White)
                        } else {
                            Icon(Icons.Rounded.Save, contentDescription = null, modifier = Modifier.size(14.dp), tint = if (isDirty) Color(0xFF001A4E) else TextMuted)
                            Spacer(Modifier.width(4.dp))
                            Text("Save", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = if (isDirty) Color(0xFF001A4E) else TextMuted)
                        }
                    }
                }
            }
        }

        // Quick Symbol Toolbar (during editing)
        if (!isPreviewMode) {
            Surface(
                color = SurfaceRaised,
                border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                modifier = Modifier.fillMaxWidth()
            ) {
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .horizontalScroll(rememberScrollState())
                        .padding(horizontal = 8.dp, vertical = 4.dp),
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    quickSymbols.forEach { sym ->
                        Surface(
                            color = SurfacePanel,
                            shape = RoundedCornerShape(6.dp),
                            border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                            modifier = Modifier
                                .clickable { vm.editorText = vm.editorText + sym }
                        ) {
                            Text(
                                text = if (sym == "  ") "TAB" else sym,
                                color = PrimaryBlue,
                                fontFamily = FontFamily.Monospace,
                                fontWeight = FontWeight.Bold,
                                fontSize = 12.sp,
                                modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp)
                            )
                        }
                    }
                }
            }
        }

        // Editor Body or Markdown Preview
        if (vm.isEditorLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = PrimaryBlue)
            }
        } else if (isPreviewMode) {
            Column(
                modifier = Modifier
                    .fillMaxSize()
                    .verticalScroll(rememberScrollState())
                    .padding(16.dp)
            ) {
                SimpleMarkdownView(text = vm.editorText)
            }
        } else {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(CodeBackground)
                    .padding(12.dp)
            ) {
                BasicTextField(
                    value = vm.editorText,
                    onValueChange = { vm.editorText = it },
                    textStyle = TextStyle(
                        color = TextPrimary,
                        fontFamily = FontFamily.Monospace,
                        fontSize = 13.sp,
                        lineHeight = 20.sp
                    ),
                    cursorBrush = SolidColor(PrimaryBlue),
                    modifier = Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                )
            }
        }
    }
}

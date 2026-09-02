package com.minio.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.minio.mobile.ui.theme.*
import com.minio.mobile.util.Formatters
import com.minio.mobile.viewmodel.MiniOViewModel

@Composable
fun FileEditorScreen(vm: MiniOViewModel) {
    var showCloseConfirmDialog by remember { mutableStateOf(false) }

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
                    .padding(horizontal = 14.dp, vertical = 8.dp),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    IconButton(onClick = {
                        if (vm.isEditorDirty) {
                            showCloseConfirmDialog = true
                        } else {
                            vm.closeEditor()
                        }
                    }) {
                        Icon(Icons.Rounded.Close, contentDescription = "Close", tint = TextMuted)
                    }

                    Column {
                        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                            Text(
                                text = vm.activeFilePath?.substringAfterLast('/') ?: "File Editor",
                                fontWeight = FontWeight.Bold,
                                color = TextPrimary,
                                fontSize = 14.sp
                            )
                            if (vm.isEditorDirty) {
                                Text("(Unsaved)", color = AccentOrange, fontSize = 11.sp, fontWeight = FontWeight.Bold)
                            }
                        }
                        Text(
                            text = vm.activeFilePath ?: "",
                            color = TextMuted,
                            fontSize = 11.sp
                        )
                    }
                }

                Row(horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                    IconButton(onClick = { vm.revertEditorChanges() }, enabled = vm.isEditorDirty) {
                        Icon(Icons.Rounded.Undo, contentDescription = "Revert", tint = if (vm.isEditorDirty) PrimaryBlue else TextMuted)
                    }

                    Button(
                        onClick = { vm.saveEditorFile() },
                        enabled = !vm.isSavingFile && vm.isEditorDirty,
                        shape = RoundedCornerShape(8.dp),
                        colors = ButtonDefaults.buttonColors(containerColor = PrimaryBlue, contentColor = Color(0xFF001A4E))
                    ) {
                        if (vm.isSavingFile) {
                            CircularProgressIndicator(modifier = Modifier.size(16.dp), strokeWidth = 2.dp, color = TextPrimary)
                        } else {
                            Icon(Icons.Rounded.Save, contentDescription = null, modifier = Modifier.size(16.dp))
                            Spacer(Modifier.width(4.dp))
                            Text("Save", fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
            }
        }

        if (vm.isEditorLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = PrimaryBlue)
            }
        } else {
            OutlinedTextField(
                value = vm.editorText,
                onValueChange = { if (!vm.isEditorReadOnly) vm.editorText = it },
                modifier = Modifier
                    .fillMaxSize()
                    .padding(8.dp),
                readOnly = vm.isEditorReadOnly,
                textStyle = LocalTextStyle.current.copy(
                    fontFamily = FontFamily.Monospace,
                    fontSize = 13.sp,
                    color = TextPrimary
                ),
                colors = OutlinedTextFieldDefaults.colors(
                    focusedBorderColor = Color.Transparent,
                    unfocusedBorderColor = Color.Transparent,
                    focusedContainerColor = InkBackground,
                    unfocusedContainerColor = InkBackground
                )
            )
        }
    }

    if (showCloseConfirmDialog) {
        AlertDialog(
            onDismissRequest = { showCloseConfirmDialog = false },
            title = { Text("Discard Unsaved Changes?") },
            text = { Text("You have unsaved edits in ${vm.activeFilePath?.substringAfterLast('/')}. Are you sure you want to exit without saving?") },
            confirmButton = {
                Button(
                    onClick = {
                        showCloseConfirmDialog = false
                        vm.closeEditor()
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DangerRed)
                ) {
                    Text("Discard Changes")
                }
            },
            dismissButton = {
                TextButton(onClick = { showCloseConfirmDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }
}

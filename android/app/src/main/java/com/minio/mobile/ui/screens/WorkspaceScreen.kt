package com.minio.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.rounded.ArrowBack
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.minio.mobile.data.FileItem
import com.minio.mobile.ui.theme.*
import com.minio.mobile.viewmodel.MiniOViewModel
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun WorkspaceScreen(vm: MiniOViewModel) {
    var showNewFileDialog by remember { mutableStateOf(false) }
    var newFileNameInput by remember { mutableStateOf("") }
    var fileToDelete by remember { mutableStateOf<FileItem?>(null) }

    Column(
        modifier = Modifier
            .fillMaxSize()
            .background(InkBackground)
    ) {
        // Workspace Top Bar
        Surface(
            color = SurfacePanel,
            border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
            modifier = Modifier.fillMaxWidth()
        ) {
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            "Workspace",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary
                        )
                        Text(
                            vm.platform?.workspaceDir?.ifEmpty { "./data" } ?: "./data",
                            color = TextMuted,
                            fontSize = 11.sp,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }

                    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        IconButton(
                            onClick = { vm.quickOpenAgentMd() },
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                Icons.Rounded.Description,
                                contentDescription = "AGENT.md",
                                tint = PrimaryBlue,
                                modifier = Modifier.size(20.dp)
                            )
                        }

                        IconButton(
                            onClick = { showNewFileDialog = true },
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                Icons.Rounded.AddCircleOutline,
                                contentDescription = "New File",
                                tint = SecondaryTeal,
                                modifier = Modifier.size(20.dp)
                            )
                        }

                        IconButton(
                            onClick = { vm.loadFolder(vm.currentFolder) },
                            modifier = Modifier.size(36.dp)
                        ) {
                            Icon(
                                Icons.Rounded.Refresh,
                                contentDescription = "Refresh",
                                tint = TextMuted,
                                modifier = Modifier.size(20.dp)
                            )
                        }
                    }
                }

                Spacer(Modifier.height(10.dp))

                // Navigation Breadcrumb Bar
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    if (vm.currentFolder != "." && vm.currentFolder.isNotBlank()) {
                        IconButton(
                            onClick = { vm.navigateUpFolder() },
                            modifier = Modifier.size(32.dp)
                        ) {
                            Icon(
                                Icons.AutoMirrored.Rounded.ArrowBack,
                                contentDescription = "Up directory",
                                tint = PrimaryBlue,
                                modifier = Modifier.size(18.dp)
                            )
                        }
                    }

                    Surface(
                        color = SurfaceRaised,
                        shape = RoundedCornerShape(8.dp),
                        modifier = Modifier
                            .weight(1f)
                            .padding(horizontal = 4.dp)
                    ) {
                        Text(
                            text = if (vm.currentFolder == ".") "root" else "root/${vm.currentFolder}",
                            color = TextSecondary,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium,
                            modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis
                        )
                    }
                }

                Spacer(Modifier.height(8.dp))

                // Search Bar
                OutlinedTextField(
                    value = vm.fileSearchQuery,
                    onValueChange = {
                        vm.fileSearchQuery = it
                        vm.loadFolder(vm.currentFolder)
                    },
                    modifier = Modifier.fillMaxWidth(),
                    placeholder = { Text("Filter workspace files...", fontSize = 13.sp, color = TextMuted) },
                    singleLine = true,
                    leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null, tint = TextMuted, modifier = Modifier.size(18.dp)) },
                    trailingIcon = {
                        if (vm.fileSearchQuery.isNotEmpty()) {
                            IconButton(onClick = {
                                vm.fileSearchQuery = ""
                                vm.loadFolder(vm.currentFolder)
                            }) {
                                Icon(Icons.Rounded.Close, contentDescription = "Clear", tint = TextMuted, modifier = Modifier.size(16.dp))
                            }
                        }
                    },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PrimaryBlue,
                        unfocusedBorderColor = BorderColor,
                        focusedContainerColor = SurfaceRaised,
                        unfocusedContainerColor = SurfaceRaised,
                        focusedTextColor = TextPrimary,
                        unfocusedTextColor = TextPrimary
                    ),
                    shape = RoundedCornerShape(10.dp)
                )
            }
        }

        // File List / Content State
        if (vm.isFilesLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = PrimaryBlue)
            }
        } else if (vm.filesError != null) {
            Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = DangerRed, modifier = Modifier.size(36.dp))
                    Spacer(Modifier.height(8.dp))
                    Text(vm.filesError!!, color = DangerRed, fontSize = 14.sp)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { vm.loadFolder(vm.currentFolder) }) {
                        Text("Retry")
                    }
                }
            }
        } else if (vm.fileItems.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize().padding(24.dp), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Rounded.FolderOpen, contentDescription = null, tint = TextMuted, modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("This directory is empty", color = TextMuted, fontSize = 14.sp)
                    Spacer(Modifier.height(12.dp))
                    Button(
                        onClick = { showNewFileDialog = true },
                        colors = ButtonDefaults.buttonColors(containerColor = PrimaryBlue)
                    ) {
                        Icon(Icons.Rounded.Add, contentDescription = null, modifier = Modifier.size(16.dp))
                        Spacer(Modifier.width(6.dp))
                        Text("Create a File", color = Color(0xFF001A4E))
                    }
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(horizontal = 10.dp, vertical = 6.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(vm.fileItems, key = { it.path }) { fileItem ->
                    FileListItemRow(
                        item = fileItem,
                        onClick = { vm.openFileItem(fileItem) },
                        onDelete = { fileToDelete = fileItem }
                    )
                }
            }
        }
    }

    // New File Dialog
    if (showNewFileDialog) {
        AlertDialog(
            onDismissRequest = { showNewFileDialog = false },
            title = { Text("Create New File", color = TextPrimary) },
            text = {
                Column {
                    Text("Enter relative filename (e.g. notes.md, test.py):", fontSize = 13.sp, color = TextMuted)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(
                        value = newFileNameInput,
                        onValueChange = { newFileNameInput = it },
                        singleLine = true,
                        placeholder = { Text("notes.md") },
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                Button(
                    onClick = {
                        if (newFileNameInput.isNotBlank()) {
                            vm.createNewFile(newFileNameInput.trim())
                            newFileNameInput = ""
                            showNewFileDialog = false
                        }
                    },
                    enabled = newFileNameInput.isNotBlank(),
                    colors = ButtonDefaults.buttonColors(containerColor = PrimaryBlue)
                ) {
                    Text("Create", color = Color(0xFF001A4E))
                }
            },
            dismissButton = {
                TextButton(onClick = { showNewFileDialog = false }) {
                    Text("Cancel", color = TextMuted)
                }
            },
            containerColor = SurfacePanel
        )
    }

    // Delete Confirmation Dialog
    if (fileToDelete != null) {
        val target = fileToDelete!!
        AlertDialog(
            onDismissRequest = { fileToDelete = null },
            title = { Text("Delete ${if (target.isDirectory) "Folder" else "File"}?", color = TextPrimary) },
            text = {
                Text(
                    "Are you sure you want to delete '${target.path}'? This action cannot be undone.",
                    color = TextSecondary,
                    fontSize = 14.sp
                )
            },
            confirmButton = {
                Button(
                    onClick = {
                        vm.deleteFile(target.path)
                        fileToDelete = null
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DangerRed)
                ) {
                    Text("Delete", color = Color.White)
                }
            },
            dismissButton = {
                TextButton(onClick = { fileToDelete = null }) {
                    Text("Cancel", color = TextMuted)
                }
            },
            containerColor = SurfacePanel
        )
    }
}

@Composable
fun FileListItemRow(
    item: FileItem,
    onClick: () -> Unit,
    onDelete: () -> Unit
) {
    Surface(
        color = SurfacePanel,
        shape = RoundedCornerShape(10.dp),
        border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor.copy(alpha = 0.6f)),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 12.dp, vertical = 10.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            // File / Folder Icon
            Box(
                modifier = Modifier
                    .size(36.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .background(
                        if (item.isDirectory) PrimaryBlue.copy(alpha = 0.15f)
                        else SurfaceRaised
                    ),
                contentAlignment = Alignment.Center
            ) {
                Icon(
                    when {
                        item.isDirectory -> Icons.Rounded.Folder
                        item.name.endsWith(".md", ignoreCase = true) -> Icons.Rounded.Description
                        item.name.endsWith(".json", ignoreCase = true) || item.name.endsWith(".yaml", ignoreCase = true) -> Icons.Rounded.SettingsSuggest
                        item.name.endsWith(".py", ignoreCase = true) || item.name.endsWith(".ts", ignoreCase = true) || item.name.endsWith(".js", ignoreCase = true) -> Icons.Rounded.Code
                        else -> Icons.Rounded.Article
                    },
                    contentDescription = null,
                    tint = if (item.isDirectory) PrimaryBlue else SecondaryTeal,
                    modifier = Modifier.size(20.dp)
                )
            }

            Spacer(Modifier.width(12.dp))

            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = item.name,
                    color = TextPrimary,
                    fontWeight = FontWeight.Medium,
                    fontSize = 14.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                val details = StringBuilder()
                if (item.isDirectory) {
                    details.append("Directory")
                } else {
                    val sizeStr = if (item.size != null) formatBytes(item.size) else "0 B"
                    details.append(sizeStr)
                }

                if (item.modified != null) {
                    val date = SimpleDateFormat("MMM d, HH:mm", Locale.getDefault()).format(Date((item.modified * 1000).toLong()))
                    details.append(" • ").append(date)
                }

                Text(
                    text = details.toString(),
                    color = TextMuted,
                    fontSize = 11.sp
                )
            }

            IconButton(
                onClick = onDelete,
                modifier = Modifier.size(32.dp)
            ) {
                Icon(
                    Icons.Rounded.DeleteOutline,
                    contentDescription = "Delete",
                    tint = TextMuted,
                    modifier = Modifier.size(18.dp)
                )
            }

            Icon(
                Icons.Rounded.ChevronRight,
                contentDescription = null,
                tint = TextMuted,
                modifier = Modifier.size(18.dp)
            )
        }
    }
}

private fun formatBytes(bytes: Long): String {
    if (bytes < 1024) return "$bytes B"
    val exp = (Math.log(bytes.toDouble()) / Math.log(1024.0)).toInt()
    val pre = "KMGTPE"[exp - 1]
    return String.format(Locale.US, "%.1f %sB", bytes / Math.pow(1024.0, exp.toDouble()), pre)
}

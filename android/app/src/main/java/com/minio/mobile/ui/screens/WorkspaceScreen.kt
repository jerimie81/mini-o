package com.minio.mobile.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.minio.mobile.data.FileItem
import com.minio.mobile.ui.theme.*
import com.minio.mobile.util.Formatters
import com.minio.mobile.viewmodel.MiniOViewModel

@Composable
fun WorkspaceScreen(vm: MiniOViewModel) {
    var showNewFileDialog by remember { mutableStateOf(false) }
    var newFileName by remember { mutableStateOf("") }
    var itemToDelete by remember { mutableStateOf<FileItem?>(null) }
    var itemToRename by remember { mutableStateOf<FileItem?>(null) }
    var renameInput by remember { mutableStateOf("") }

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
            Column(modifier = Modifier.padding(14.dp)) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(6.dp)
                    ) {
                        IconButton(onClick = { vm.navigateUpFolder() }) {
                            Icon(Icons.Rounded.ArrowBack, contentDescription = "Back", tint = PrimaryBlue)
                        }
                        Text(
                            text = "Path: ${vm.currentFolder}",
                            fontWeight = FontWeight.Bold,
                            color = TextPrimary,
                            fontSize = 14.sp
                        )
                    }

                    Row {
                        IconButton(onClick = { vm.loadFolder() }) {
                            Icon(Icons.Rounded.Refresh, contentDescription = "Refresh", tint = TextMuted)
                        }
                        IconButton(onClick = { showNewFileDialog = true }) {
                            Icon(Icons.Rounded.Add, contentDescription = "New File", tint = PrimaryBlue)
                        }
                    }
                }

                Spacer(Modifier.height(6.dp))

                OutlinedTextField(
                    value = vm.fileSearchQuery,
                    onValueChange = {
                        vm.fileSearchQuery = it
                        vm.loadFolder()
                    },
                    placeholder = { Text("Filter folder files...", fontSize = 12.sp) },
                    modifier = Modifier.fillMaxWidth(),
                    shape = RoundedCornerShape(10.dp),
                    leadingIcon = { Icon(Icons.Rounded.Search, contentDescription = null, tint = TextMuted) },
                    colors = OutlinedTextFieldDefaults.colors(
                        focusedBorderColor = PrimaryBlue,
                        unfocusedBorderColor = BorderColor,
                        focusedContainerColor = InkBackground,
                        unfocusedContainerColor = InkBackground
                    )
                )
            }
        }

        if (vm.isFilesLoading) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(color = PrimaryBlue)
            }
        } else if (vm.filesError != null) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Rounded.ErrorOutline, contentDescription = null, tint = DangerRed, modifier = Modifier.size(40.dp))
                    Spacer(Modifier.height(8.dp))
                    Text(vm.filesError!!, color = DangerRed, fontSize = 13.sp)
                    Spacer(Modifier.height(12.dp))
                    Button(onClick = { vm.loadFolder() }) {
                        Text("Retry")
                    }
                }
            }
        } else if (vm.fileItems.isEmpty()) {
            Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Rounded.FolderOff, contentDescription = null, tint = TextMuted, modifier = Modifier.size(48.dp))
                    Spacer(Modifier.height(8.dp))
                    Text("This folder is empty", color = TextMuted, fontSize = 13.sp)
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.fillMaxSize(),
                contentPadding = PaddingValues(12.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                items(vm.fileItems, key = { it.path }) { item ->
                    Card(
                        colors = CardDefaults.cardColors(containerColor = SurfacePanel),
                        border = androidx.compose.foundation.BorderStroke(1.dp, BorderColor),
                        shape = RoundedCornerShape(10.dp),
                        modifier = Modifier
                            .fillMaxWidth()
                            .clickable { vm.openFileItem(item) }
                    ) {
                        Row(
                            modifier = Modifier
                                .padding(12.dp)
                                .fillMaxWidth(),
                            horizontalArrangement = Arrangement.SpaceBetween,
                            verticalAlignment = Alignment.CenterVertically
                        ) {
                            Row(
                                verticalAlignment = Alignment.CenterVertically,
                                horizontalArrangement = Arrangement.spacedBy(10.dp)
                            ) {
                                Icon(
                                    if (item.isDirectory) Icons.Rounded.Folder else Icons.Rounded.InsertDriveFile,
                                    contentDescription = null,
                                    tint = if (item.isDirectory) PrimaryBlue else SecondaryTeal
                                )
                                Column {
                                    Text(item.name, fontWeight = FontWeight.Bold, color = TextPrimary, fontSize = 13.sp)
                                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                        Text(
                                            if (item.isDirectory) "Directory" else Formatters.formatFileSize(item.size),
                                            color = TextMuted,
                                            fontSize = 11.sp
                                        )
                                        if (item.modified != null) {
                                            Text(
                                                Formatters.formatTimestamp(item.modified),
                                                color = TextMuted,
                                                fontSize = 11.sp
                                            )
                                        }
                                    }
                                }
                            }

                            Row {
                                IconButton(onClick = {
                                    itemToRename = item
                                    renameInput = item.name
                                }) {
                                    Icon(Icons.Rounded.Edit, contentDescription = "Rename", tint = TextMuted)
                                }
                                IconButton(onClick = { itemToDelete = item }) {
                                    Icon(Icons.Rounded.Delete, contentDescription = "Delete", tint = DangerRed)
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if (showNewFileDialog) {
        AlertDialog(
            onDismissRequest = { showNewFileDialog = false },
            title = { Text("Create New File") },
            text = {
                OutlinedTextField(
                    value = newFileName,
                    onValueChange = { newFileName = it },
                    label = { Text("Filename") },
                    placeholder = { Text("script.py") }
                )
            },
            confirmButton = {
                Button(onClick = {
                    showNewFileDialog = false
                    if (newFileName.isNotBlank()) {
                        vm.createNewFile(newFileName)
                        newFileName = ""
                    }
                }) {
                    Text("Create")
                }
            },
            dismissButton = {
                TextButton(onClick = { showNewFileDialog = false }) { Text("Cancel") }
            }
        )
    }

    if (itemToDelete != null) {
        AlertDialog(
            onDismissRequest = { itemToDelete = null },
            title = { Text("Confirm Delete") },
            text = { Text("Are you sure you want to delete ${itemToDelete!!.name}?") },
            confirmButton = {
                Button(
                    onClick = {
                        val path = itemToDelete!!.path
                        itemToDelete = null
                        vm.deleteFile(path)
                    },
                    colors = ButtonDefaults.buttonColors(containerColor = DangerRed)
                ) {
                    Text("Delete")
                }
            },
            dismissButton = {
                TextButton(onClick = { itemToDelete = null }) { Text("Cancel") }
            }
        )
    }

    if (itemToRename != null) {
        AlertDialog(
            onDismissRequest = { itemToRename = null },
            title = { Text("Rename File/Folder") },
            text = {
                OutlinedTextField(
                    value = renameInput,
                    onValueChange = { renameInput = it },
                    label = { Text("New Name") }
                )
            },
            confirmButton = {
                Button(onClick = {
                    val oldPath = itemToRename!!.path
                    itemToRename = null
                    if (renameInput.isNotBlank()) {
                        vm.renameFile(oldPath, renameInput)
                    }
                }) {
                    Text("Rename")
                }
            },
            dismissButton = {
                TextButton(onClick = { itemToRename = null }) { Text("Cancel") }
            }
        )
    }
}

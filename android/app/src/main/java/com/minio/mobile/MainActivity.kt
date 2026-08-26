package com.minio.mobile

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
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
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.minio.mobile.data.Connection
import com.minio.mobile.data.ScreenTab
import com.minio.mobile.ui.screens.*
import com.minio.mobile.ui.theme.*
import com.minio.mobile.viewmodel.MiniOViewModel
import kotlinx.coroutines.delay

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            MiniOTheme {
                MiniOMainApp()
            }
        }
    }
}

@Composable
fun MiniOMainApp(vm: MiniOViewModel = viewModel()) {
    val context = LocalContext.current
    val prefs = remember {
        runCatching {
            val key = MasterKey.Builder(context)
                .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                .build()
            EncryptedSharedPreferences.create(
                context,
                "mini_o_connection",
                key,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM
            )
        }.getOrNull()
    }

    val savedUrl = prefs?.getString("url", "") ?: ""
    val savedToken = prefs?.getString("token", "") ?: ""

    var urlInput by remember { mutableStateOf(savedUrl) }
    var tokenInput by remember { mutableStateOf(savedToken) }

    // Auto toast dismiss
    LaunchedEffect(vm.notificationMessage) {
        if (vm.notificationMessage != null) {
            delay(3000)
            vm.clearToast()
        }
    }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = InkBackground
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            if (!vm.isConnected) {
                ConnectScreen(
                    url = urlInput,
                    onUrlChange = { urlInput = it },
                    token = tokenInput,
                    onTokenChange = { tokenInput = it },
                    isLoading = vm.isConnecting,
                    errorMessage = vm.connectionError,
                    onConnect = {
                        vm.connect(urlInput, tokenInput) { conn ->
                            prefs?.edit()
                                ?.putString("url", conn.url)
                                ?.putString("token", conn.token)
                                ?.apply()
                        }
                    }
                )
            } else if (vm.activeFilePath != null) {
                FileEditorScreen(vm = vm)
            } else {
                Scaffold(
                    bottomBar = {
                        NavigationBar(
                            containerColor = SurfacePanel,
                            tonalElevation = 8.dp
                        ) {
                            NavigationBarItem(
                                selected = vm.currentTab == ScreenTab.CHAT,
                                onClick = { vm.currentTab = ScreenTab.CHAT },
                                icon = {
                                    Icon(
                                        Icons.Rounded.ChatBubbleOutline,
                                        contentDescription = "Chat"
                                    )
                                },
                                label = { Text("Chat", fontSize = 11.sp, fontWeight = FontWeight.Medium) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = PrimaryBlue,
                                    selectedTextColor = PrimaryBlue,
                                    indicatorColor = SurfaceRaised,
                                    unselectedIconColor = TextMuted,
                                    unselectedTextColor = TextMuted
                                )
                            )

                            NavigationBarItem(
                                selected = vm.currentTab == ScreenTab.WORKSPACE,
                                onClick = { vm.currentTab = ScreenTab.WORKSPACE },
                                icon = {
                                    Icon(
                                        Icons.Rounded.FolderOpen,
                                        contentDescription = "Workspace"
                                    )
                                },
                                label = { Text("Files", fontSize = 11.sp, fontWeight = FontWeight.Medium) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = PrimaryBlue,
                                    selectedTextColor = PrimaryBlue,
                                    indicatorColor = SurfaceRaised,
                                    unselectedIconColor = TextMuted,
                                    unselectedTextColor = TextMuted
                                )
                            )

                            NavigationBarItem(
                                selected = vm.currentTab == ScreenTab.DIAGNOSTICS,
                                onClick = { vm.currentTab = ScreenTab.DIAGNOSTICS },
                                icon = {
                                    Icon(
                                        Icons.Rounded.MonitorHeart,
                                        contentDescription = "System"
                                    )
                                },
                                label = { Text("System", fontSize = 11.sp, fontWeight = FontWeight.Medium) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = PrimaryBlue,
                                    selectedTextColor = PrimaryBlue,
                                    indicatorColor = SurfaceRaised,
                                    unselectedIconColor = TextMuted,
                                    unselectedTextColor = TextMuted
                                )
                            )

                            NavigationBarItem(
                                selected = vm.currentTab == ScreenTab.SETTINGS,
                                onClick = { vm.currentTab = ScreenTab.SETTINGS },
                                icon = {
                                    Icon(
                                        Icons.Rounded.Settings,
                                        contentDescription = "Settings"
                                    )
                                },
                                label = { Text("Settings", fontSize = 11.sp, fontWeight = FontWeight.Medium) },
                                colors = NavigationBarItemDefaults.colors(
                                    selectedIconColor = PrimaryBlue,
                                    selectedTextColor = PrimaryBlue,
                                    indicatorColor = SurfaceRaised,
                                    unselectedIconColor = TextMuted,
                                    unselectedTextColor = TextMuted
                                )
                            )
                        }
                    }
                ) { innerPadding ->
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .padding(innerPadding)
                    ) {
                        when (vm.currentTab) {
                            ScreenTab.CHAT -> ChatScreen(vm = vm)
                            ScreenTab.WORKSPACE -> WorkspaceScreen(vm = vm)
                            ScreenTab.DIAGNOSTICS -> DiagnosticsScreen(vm = vm)
                            ScreenTab.SETTINGS -> SettingsScreen(vm = vm)
                        }
                    }
                }
            }

            // Global Notification Toast
            if (vm.notificationMessage != null) {
                Surface(
                    color = SurfaceRaised,
                    shape = RoundedCornerShape(10.dp),
                    border = androidx.compose.foundation.BorderStroke(1.dp, PrimaryBlue.copy(alpha = 0.5f)),
                    modifier = Modifier
                        .align(Alignment.TopCenter)
                        .padding(top = 16.dp, start = 16.dp, end = 16.dp)
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 14.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.spacedBy(8.dp)
                    ) {
                        Icon(
                            Icons.Rounded.Info,
                            contentDescription = null,
                            tint = PrimaryBlue,
                            modifier = Modifier.size(16.dp)
                        )
                        Text(
                            text = vm.notificationMessage!!,
                            color = TextPrimary,
                            fontSize = 13.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }
    }
}

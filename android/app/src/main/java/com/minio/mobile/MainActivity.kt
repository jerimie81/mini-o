package com.minio.mobile

import android.Manifest
import android.content.pm.PackageManager
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.*
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.rounded.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey
import com.minio.mobile.data.Connection
import com.minio.mobile.data.ScreenTab
import com.minio.mobile.ui.screens.*
import com.minio.mobile.ui.theme.*
import com.minio.mobile.viewmodel.MiniOViewModel
import com.minio.mobile.voice.VoiceAssistantManager
import com.minio.mobile.voice.VoiceState
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

    DisposableEffect(Unit) {
        val voiceMgr = VoiceAssistantManager(
            context = context,
            onStateChanged = { vm.voiceState = it },
            onRmsChanged = { vm.voiceRmsDb = it },
            onSpeechResult = { vm.onVoiceInput(it) },
            onError = { vm.showToast(it) }
        )
        vm.voiceAssistantManager = voiceMgr
        onDispose {
            voiceMgr.destroy()
        }
    }

    val audioPermissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { isGranted ->
        if (isGranted) {
            vm.toggleVoice()
        } else {
            vm.showToast("Microphone permission is needed for voice chat.")
        }
    }

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
                            tonalElevation = 8.dp,
                            modifier = Modifier.height(76.dp)
                        ) {
                            // 1. Chat
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

                            // 2. Files
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

                            // 3. DEAD CENTER: Mic / Voice Button
                            CenterVoiceNavButton(
                                voiceState = vm.voiceState,
                                onClick = {
                                    val hasAudioPerm = ContextCompat.checkSelfPermission(
                                        context,
                                        Manifest.permission.RECORD_AUDIO
                                    ) == PackageManager.PERMISSION_GRANTED

                                    if (hasAudioPerm) {
                                        vm.toggleVoice()
                                    } else {
                                        audioPermissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
                                    }
                                }
                            )

                            // 4. System
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

                            // 5. Settings
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

@Composable
fun RowScope.CenterVoiceNavButton(
    voiceState: VoiceState,
    onClick: () -> Unit
) {
    val infiniteTransition = rememberInfiniteTransition(label = "voice_pulse")
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = if (voiceState == VoiceState.LISTENING) 1.22f else 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(650, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse_scale"
    )
    val pulseAlpha by infiniteTransition.animateFloat(
        initialValue = 0.6f,
        targetValue = if (voiceState == VoiceState.LISTENING) 0.15f else 0.6f,
        animationSpec = infiniteRepeatable(
            animation = tween(650, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "pulse_alpha"
    )

    Column(
        modifier = Modifier
            .weight(1f)
            .fillMaxHeight()
            .clickable(onClick = onClick),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(
            contentAlignment = Alignment.Center,
            modifier = Modifier.size(46.dp)
        ) {
            if (voiceState == VoiceState.LISTENING) {
                Box(
                    modifier = Modifier
                        .size(46.dp)
                        .scale(pulseScale)
                        .clip(CircleShape)
                        .background(DangerRed.copy(alpha = pulseAlpha))
                )
            } else if (voiceState == VoiceState.SPEAKING) {
                Box(
                    modifier = Modifier
                        .size(46.dp)
                        .scale(pulseScale)
                        .clip(CircleShape)
                        .background(SecondaryTeal.copy(alpha = 0.25f))
                )
            }

            Surface(
                shape = CircleShape,
                color = when (voiceState) {
                    VoiceState.LISTENING -> DangerRed
                    VoiceState.SPEAKING -> SecondaryTeal
                    VoiceState.PROCESSING -> AccentOrange
                    VoiceState.IDLE -> PrimaryBlue
                },
                shadowElevation = 6.dp,
                modifier = Modifier.size(38.dp)
            ) {
                Box(
                    contentAlignment = Alignment.Center,
                    modifier = Modifier.fillMaxSize()
                ) {
                    when (voiceState) {
                        VoiceState.LISTENING -> Icon(Icons.Rounded.Mic, contentDescription = null, tint = Color.White, modifier = Modifier.size(22.dp))
                        VoiceState.SPEAKING -> Icon(Icons.Rounded.GraphicEq, contentDescription = null, tint = Color(0xFF002A24), modifier = Modifier.size(22.dp))
                        VoiceState.PROCESSING -> CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White)
                        VoiceState.IDLE -> Icon(Icons.Rounded.Mic, contentDescription = null, tint = Color(0xFF001A4E), modifier = Modifier.size(22.dp))
                    }
                }
            }
        }

        Spacer(Modifier.height(3.dp))

        Text(
            text = when (voiceState) {
                VoiceState.LISTENING -> "Listening"
                VoiceState.SPEAKING -> "Speaking"
                VoiceState.PROCESSING -> "Thinking"
                VoiceState.IDLE -> "Voice"
            },
            fontSize = 10.sp,
            fontWeight = if (voiceState != VoiceState.IDLE) FontWeight.Bold else FontWeight.Medium,
            color = when (voiceState) {
                VoiceState.LISTENING -> DangerRed
                VoiceState.SPEAKING -> SecondaryTeal
                VoiceState.PROCESSING -> AccentOrange
                VoiceState.IDLE -> TextMuted
            }
        )
    }
}


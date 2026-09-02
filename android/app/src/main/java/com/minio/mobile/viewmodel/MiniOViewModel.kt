package com.minio.mobile.viewmodel

import android.content.Context
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.viewModelScope
import com.minio.mobile.data.*
import com.minio.mobile.util.*
import com.minio.mobile.voice.VoiceAssistantManager
import com.minio.mobile.voice.VoiceState
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MiniOViewModel(
    val repository: MiniORepository,
    val dispatchers: DispatchersProvider = DefaultDispatchersProvider()
) : ViewModel() {

    var connectionProfiles by mutableStateOf<List<ConnectionProfile>>(emptyList()); private set
    var activeConnectionId by mutableStateOf<String?>(null); private set
    var connection by mutableStateOf<Connection?>(null); private set
    var isConnected by mutableStateOf(false); private set
    var isConnecting by mutableStateOf(false); private set
    var connectionError by mutableStateOf<String?>(null); private set
    var lastConnectionTime by mutableStateOf(0L); private set

    // LAN & mDNS Discovery State
    var isScanningLan by mutableStateOf(false); private set
    var discoveredServers by mutableStateOf<List<DiscoveredServer>>(emptyList()); private set
    var scanProgress by mutableStateOf(0f); private set
    private var scanJob: Job? = null
    private var nsdJob: Job? = null

    var currentTab by mutableStateOf(ScreenTab.CHAT)
    var notificationMessage by mutableStateOf<String?>(null); private set
    var isOffline by mutableStateOf(false)
    var themeMode by mutableStateOf("SYSTEM")

    // Voice State
    var voiceState by mutableStateOf(VoiceState.IDLE)
    var voiceRmsDb by mutableStateOf(0f)
    var isVoiceOutputEnabled by mutableStateOf(true)
    var wasLastInputVoice by mutableStateOf(false); private set
    var voiceAssistantManager: VoiceAssistantManager? = null
    var taskNotificationManager: TaskNotificationManager? = null

    // Server Info
    var health by mutableStateOf<ServerHealth?>(null); private set
    var platform by mutableStateOf<PlatformInfo?>(null); private set
    var diagnostics by mutableStateOf<DiagnosticInfo?>(null); private set
    var availableModels by mutableStateOf<List<ModelInfo>>(emptyList()); private set
    var selectedModel by mutableStateOf("minimax-m3:cloud")

    // Chat State & Threads
    var threads by mutableStateOf<List<ConversationThread>>(emptyList()); private set
    var activeThreadId by mutableStateOf<String?>(null); private set
    var chatMessages by mutableStateOf<List<ChatMessage>>(
        listOf(
            ChatMessage(
                role = "assistant",
                content = "Welcome to **Mini-O Mobile**! I am connected to your local AI workspace on your PC."
            )
        )
    ); private set
    var chatInput by mutableStateOf("")
    var isChatStreaming by mutableStateOf(false); private set
    var activeToolNotification by mutableStateOf<String?>(null); private set
    var streamTokenCount by mutableStateOf(0); private set
    var streamStartTime by mutableStateOf(0L); private set
    var tokensPerSec by mutableStateOf(0.0); private set
    private var streamingJob: Job? = null

    // Workspace & Files State
    var currentFolder by mutableStateOf(".")
    var fileItems by mutableStateOf<List<FileItem>>(emptyList()); private set
    var fileSearchQuery by mutableStateOf("")
    var isFilesLoading by mutableStateOf(false); private set
    var filesError by mutableStateOf<String?>(null); private set
    var selectedFileItems by mutableStateOf<Set<String>>(emptySet())

    // File Editor State
    var activeFilePath by mutableStateOf<String?>(null); private set
    var editorOriginalContent by mutableStateOf(""); private set
    var editorText by mutableStateOf("")
    var editorModifiedTimestamp by mutableStateOf<Double?>(null); private set
    var isEditorReadOnly by mutableStateOf(false)
    var isSavingFile by mutableStateOf(false); private set
    var isEditorLoading by mutableStateOf(false); private set
    val isEditorDirty: Boolean get() = activeFilePath != null && editorText != editorOriginalContent

    init {
        loadSettingsAndProfiles()
    }

    private fun loadSettingsAndProfiles() {
        connectionProfiles = repository.connectionStore.getProfiles()
        activeConnectionId = repository.connectionStore.getActiveProfileId()
        lastConnectionTime = repository.connectionStore.getLastConnectionTime()
        themeMode = repository.connectionStore.getThemePreference()

        repository.connectionStore.getSelectedModel()?.let {
            if (it.isNotBlank()) selectedModel = it
        }

        val loadedThreads = repository.chatStorage.getThreads()
        if (loadedThreads.isNotEmpty()) {
            threads = loadedThreads
            val activeId = repository.chatStorage.getActiveThreadId() ?: loadedThreads.first().id
            activeThreadId = activeId
            val active = loadedThreads.find { it.id == activeId }
            if (active != null && active.messages.isNotEmpty()) {
                chatMessages = active.messages
            }
        }
    }

    fun showToast(msg: String) {
        notificationMessage = msg
    }

    fun clearToast() {
        notificationMessage = null
    }

    fun setTheme(mode: String) {
        themeMode = mode
        repository.connectionStore.saveThemePreference(mode)
    }

    fun startMdnsDiscovery(context: Context) {
        nsdJob?.cancel()
        val nsd = NsdServerDiscovery(context)
        nsdJob = viewModelScope.launch(dispatchers.io) {
            nsd.discoverServices().collect { server ->
                withContext(dispatchers.main) {
                    if (discoveredServers.none { it.url == server.url }) {
                        discoveredServers = discoveredServers + server
                        showToast("mDNS Zero-Config: Found ${server.name}")
                    }
                }
            }
        }
    }

    fun parseAndApplyQrPayload(qrText: String, onParsed: (ConnectionProfile) -> Unit) {
        val profile = QrPairingHelper.parsePairingPayload(qrText)
        if (profile != null) {
            onParsed(profile)
            showToast("Imported pairing config for ${profile.name}")
        } else {
            showToast("Invalid QR pairing code format")
        }
    }

    fun scanLanServers(context: Context) {
        if (isScanningLan) return
        isScanningLan = true
        discoveredServers = emptyList()
        scanProgress = 0f

        startMdnsDiscovery(context)

        val scanner = LanServerScanner(context)
        scanJob = viewModelScope.launch(dispatchers.io) {
            scanner.scanSubnet(
                onProgress = { scanned, total ->
                    viewModelScope.launch(dispatchers.main) {
                        scanProgress = scanned.toFloat() / total.toFloat()
                    }
                }
            ).collect { server ->
                withContext(dispatchers.main) {
                    if (discoveredServers.none { it.url == server.url }) {
                        discoveredServers = discoveredServers + server
                        showToast("Found Mini-O server: ${server.name}")
                    }
                }
            }

            withContext(dispatchers.main) {
                isScanningLan = false
                if (discoveredServers.isEmpty()) {
                    showToast("No Mini-O servers found on local WiFi network")
                }
            }
        }
    }

    fun stopLanScan() {
        scanJob?.cancel()
        scanJob = null
        nsdJob?.cancel()
        nsdJob = null
        isScanningLan = false
    }

    fun connect(url: String, token: String, name: String = "Default", onConnected: (Connection) -> Unit = {}) {
        val normalizedUrl = url.trim().removeSuffix("/")
        if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
            connectionError = "Please enter a valid URL starting with http:// or https://"
            return
        }

        isConnecting = true
        connectionError = null

        viewModelScope.launch(dispatchers.io) {
            val conn = Connection(normalizedUrl, token.trim())
            repository.initClient(
                conn,
                connectTimeoutSec = repository.connectionStore.getConnectTimeout().toLong(),
                readTimeoutSec = repository.connectionStore.getReadTimeout().toLong()
            )

            val healthRes = repository.checkHealth()
            if (healthRes.isSuccess) {
                val h = healthRes.getOrNull()
                val platRes = repository.getPlatform()
                val modelsRes = repository.getModels()
                val now = System.currentTimeMillis()

                withContext(dispatchers.main) {
                    val profile = ConnectionProfile(name = name, url = normalizedUrl, token = token.trim())
                    val updatedProfiles = (connectionProfiles.filter { it.url != normalizedUrl } + profile)
                    connectionProfiles = updatedProfiles
                    repository.connectionStore.saveProfiles(updatedProfiles)

                    activeConnectionId = profile.id
                    repository.connectionStore.saveActiveProfileId(profile.id)

                    connection = conn
                    isConnected = true
                    health = h
                    platform = platRes.getOrNull()
                    lastConnectionTime = now
                    repository.connectionStore.saveLastConnectionTime(now)

                    val models = modelsRes.getOrNull() ?: emptyList()
                    availableModels = models
                    if (models.isNotEmpty() && repository.connectionStore.getSelectedModel() == null) {
                        selectedModel = models.first().name
                    }
                    isConnecting = false
                    onConnected(conn)
                    loadFolder(".")
                    refreshDiagnostics()
                }
            } else {
                withContext(dispatchers.main) {
                    val err = healthRes.exceptionOrNull()
                    connectionError = if (err is ApiError) err.toUserMessage() else (err?.message ?: "Could not connect to Mini-O server")
                    isConnecting = false
                }
            }
        }
    }

    fun disconnect(profileId: String? = null) {
        if (profileId != null && activeConnectionId != profileId) return
        streamingJob?.cancel()
        repository.disconnect()
        connection = null
        isConnected = false
        activeConnectionId = null
        fileItems = emptyList()
        activeFilePath = null
        isChatStreaming = false
    }

    fun forgetServer(profileId: String) {
        val updated = connectionProfiles.filter { it.id != profileId }
        connectionProfiles = updated
        repository.connectionStore.saveProfiles(updated)
        if (activeConnectionId == profileId) {
            disconnect()
        }
        showToast("Server profile removed")
    }

    fun pingServer() {
        if (!isConnected) return
        viewModelScope.launch(dispatchers.io) {
            val startTime = System.currentTimeMillis()
            val res = repository.checkHealth()
            val elapsed = System.currentTimeMillis() - startTime
            withContext(dispatchers.main) {
                if (res.isSuccess) {
                    showToast("Server reachable (${elapsed}ms)")
                } else {
                    val msg = res.exceptionOrNull()?.let { if (it is ApiError) it.toUserMessage() else it.message }
                    showToast("Server unreachable: $msg")
                }
            }
        }
    }

    fun refreshDiagnostics() {
        if (!isConnected) return
        viewModelScope.launch(dispatchers.io) {
            val diagRes = repository.getDiagnostics()
            val platRes = repository.getPlatform()
            val modRes = repository.getModels()
            withContext(dispatchers.main) {
                diagnostics = diagRes.getOrNull()
                platform = platRes.getOrNull()
                if (modRes.isSuccess) {
                    availableModels = modRes.getOrNull() ?: emptyList()
                }
            }
        }
    }

    fun selectModel(modelName: String) {
        selectedModel = modelName
        repository.connectionStore.saveSelectedModel(modelName)
    }

    // Chat Operations
    fun sendChatMessage(promptText: String = chatInput, fromVoice: Boolean = false) {
        val prompt = promptText.trim()
        if (prompt.isEmpty() || isChatStreaming) return
        if (!isConnected) {
            showToast("Not connected to server")
            return
        }

        wasLastInputVoice = fromVoice
        voiceAssistantManager?.stopSpeaking()

        val userMessage = ChatMessage(role = "user", content = prompt)
        val assistantMessageId = java.util.UUID.randomUUID().toString()
        val initialAssistantMessage = ChatMessage(
            id = assistantMessageId,
            role = "assistant",
            content = "",
            isStreaming = true
        )

        val updatedMessages = chatMessages + userMessage + initialAssistantMessage
        chatMessages = updatedMessages
        chatInput = ""
        isChatStreaming = true
        activeToolNotification = null
        streamTokenCount = 0
        streamStartTime = System.currentTimeMillis()

        saveCurrentThread()

        val historyForApi = updatedMessages.filter { it.id != assistantMessageId }

        streamingJob = viewModelScope.launch(dispatchers.io) {
            repository.streamChat(
                model = selectedModel,
                messages = historyForApi,
                conversationId = activeThreadId,
                useTools = true,
                onToken = { tokenChunk ->
                    viewModelScope.launch(dispatchers.main) {
                        streamTokenCount++
                        val elapsedSec = (System.currentTimeMillis() - streamStartTime) / 1000.0
                        if (elapsedSec > 0) tokensPerSec = streamTokenCount / elapsedSec

                        chatMessages = chatMessages.map { msg ->
                            if (msg.id == assistantMessageId) {
                                msg.copy(content = msg.content + tokenChunk)
                            } else msg
                        }
                    }
                },
                onToolCall = { name, _ ->
                    viewModelScope.launch(dispatchers.main) {
                        activeToolNotification = "Running tool: $name"
                    }
                },
                onToolResult = { name, _ ->
                    viewModelScope.launch(dispatchers.main) {
                        activeToolNotification = "Tool $name finished"
                    }
                },
                onDone = {
                    viewModelScope.launch(dispatchers.main) {
                        var finalAssistantText = ""
                        chatMessages = chatMessages.map { msg ->
                            if (msg.id == assistantMessageId) {
                                finalAssistantText = msg.content
                                msg.copy(isStreaming = false)
                            } else msg
                        }
                        isChatStreaming = false
                        activeToolNotification = null
                        saveCurrentThread()

                        taskNotificationManager?.showTaskCompleteNotification(
                            title = "Mini-O AI Response Complete",
                            message = finalAssistantText.take(60)
                        )

                        if (wasLastInputVoice && isVoiceOutputEnabled && finalAssistantText.isNotBlank()) {
                            voiceAssistantManager?.speak(finalAssistantText)
                        }
                    }
                },
                onError = { err ->
                    viewModelScope.launch(dispatchers.main) {
                        val errMsg = "⚠️ Error: $err"
                        chatMessages = chatMessages.map { msg ->
                            if (msg.id == assistantMessageId) {
                                msg.copy(
                                    content = if (msg.content.isEmpty()) errMsg else "${msg.content}\n\n$errMsg",
                                    isStreaming = false
                                )
                            } else msg
                        }
                        isChatStreaming = false
                        activeToolNotification = null
                        saveCurrentThread()

                        if (wasLastInputVoice && isVoiceOutputEnabled) {
                            voiceAssistantManager?.speak("Sorry, an error occurred while generating a response.")
                        }
                    }
                }
            )
        }
    }

    fun regenerateLastResponse() {
        val lastAssistant = chatMessages.lastOrNull { it.role == "assistant" && !it.isStreaming } ?: return
        chatMessages = chatMessages.filter { it.id != lastAssistant.id }
        sendChatMessage(chatMessages.lastOrNull { it.role == "user" }?.content ?: return)
    }

    fun deleteChatMessage(messageId: String) {
        chatMessages = chatMessages.filter { it.id != messageId }
        saveCurrentThread()
    }

    private fun saveCurrentThread() {
        val activeId = activeThreadId ?: java.util.UUID.randomUUID().toString()
        activeThreadId = activeId
        val existingIndex = threads.indexOfFirst { it.id == activeId }
        val thread = ConversationThread(
            id = activeId,
            title = chatMessages.firstOrNull { it.role == "user" }?.content?.take(30) ?: "Conversation",
            updatedAt = System.currentTimeMillis(),
            messages = chatMessages
        )
        threads = if (existingIndex >= 0) {
            threads.toMutableList().apply { set(existingIndex, thread) }
        } else {
            threads + thread
        }
        repository.chatStorage.saveThreads(threads)
        repository.chatStorage.saveActiveThreadId(activeId)
    }

    fun createNewThread() {
        stopChatGeneration()
        val newThread = ConversationThread()
        threads = threads + newThread
        activeThreadId = newThread.id
        chatMessages = listOf(
            ChatMessage(
                role = "assistant",
                content = "New conversation started. How can I help you?"
            )
        )
        saveCurrentThread()
    }

    fun clearChat() {
        createNewThread()
    }

    fun onVoiceInput(transcribedText: String) {
        currentTab = ScreenTab.CHAT
        sendChatMessage(promptText = transcribedText, fromVoice = true)
    }

    fun toggleVoice() {
        when (voiceState) {
            VoiceState.SPEAKING -> voiceAssistantManager?.stopSpeaking()
            VoiceState.LISTENING -> voiceAssistantManager?.stopListening()
            VoiceState.PROCESSING -> voiceAssistantManager?.cancelListening()
            VoiceState.IDLE -> {
                currentTab = ScreenTab.CHAT
                voiceAssistantManager?.startListening()
            }
        }
    }

    fun stopSpeaking() {
        voiceAssistantManager?.stopSpeaking()
    }

    fun stopChatGeneration() {
        streamingJob?.cancel()
        streamingJob = null
        isChatStreaming = false
        chatMessages = chatMessages.map { if (it.isStreaming) it.copy(isStreaming = false) else it }
        activeToolNotification = null
    }

    // Workspace & File Operations
    fun loadFolder(path: String = currentFolder) {
        if (!isConnected) return
        isFilesLoading = true
        filesError = null

        viewModelScope.launch(dispatchers.io) {
            val res = repository.listFiles(path, fileSearchQuery)
            withContext(dispatchers.main) {
                isFilesLoading = false
                if (res.isSuccess) {
                    currentFolder = path
                    fileItems = res.getOrNull() ?: emptyList()
                    selectedFileItems = emptySet()
                } else {
                    val err = res.exceptionOrNull()
                    filesError = if (err is ApiError) err.toUserMessage() else (err?.message ?: "Failed to list folder")
                }
            }
        }
    }

    fun navigateUpFolder() {
        if (currentFolder == "." || currentFolder.isEmpty()) return
        val parent = currentFolder.substringBeforeLast('/', ".").ifBlank { "." }
        loadFolder(parent)
    }

    fun openFileItem(item: FileItem) {
        if (item.isDirectory) {
            loadFolder(item.path)
        } else {
            openFileInEditor(item.path)
        }
    }

    fun openFileInEditor(filePath: String) {
        if (!isConnected) return
        isEditorLoading = true
        activeFilePath = filePath

        viewModelScope.launch(dispatchers.io) {
            val res = repository.getFileContent(filePath)
            withContext(dispatchers.main) {
                isEditorLoading = false
                if (res.isSuccess) {
                    val data = res.getOrNull()!!
                    editorOriginalContent = data.content
                    editorText = data.content
                    editorModifiedTimestamp = data.modified
                    isEditorReadOnly = false
                } else {
                    showToast("Error opening file: ${res.exceptionOrNull()?.message}")
                    activeFilePath = null
                }
            }
        }
    }

    fun quickOpenAgentMd() {
        openFileInEditor("AGENT.md")
    }

    fun saveEditorFile() {
        val path = activeFilePath ?: return
        if (!isConnected) return
        isSavingFile = true

        viewModelScope.launch(dispatchers.io) {
            val res = repository.saveFileContent(path, editorText, editorModifiedTimestamp)
            withContext(dispatchers.main) {
                isSavingFile = false
                if (res.isSuccess) {
                    val saveInfo = res.getOrNull()
                    editorOriginalContent = editorText
                    editorModifiedTimestamp = saveInfo?.modified
                    showToast("Saved $path successfully")
                    loadFolder(currentFolder)
                } else {
                    showToast("Failed to save: ${res.exceptionOrNull()?.message}")
                }
            }
        }
    }

    fun revertEditorChanges() {
        editorText = editorOriginalContent
        showToast("Reverted changes")
    }

    fun closeEditor() {
        activeFilePath = null
        editorText = ""
        editorOriginalContent = ""
    }

    fun createNewFile(fileName: String, initialContent: String = "") {
        val targetPath = if (currentFolder == ".") fileName.trim() else "$currentFolder/${fileName.trim()}"
        viewModelScope.launch(dispatchers.io) {
            val res = repository.saveFileContent(targetPath, initialContent)
            withContext(dispatchers.main) {
                if (res.isSuccess) {
                    showToast("Created $fileName")
                    loadFolder(currentFolder)
                    openFileInEditor(targetPath)
                } else {
                    showToast("Create failed: ${res.exceptionOrNull()?.message}")
                }
            }
        }
    }

    fun renameFile(oldPath: String, newName: String) {
        val parent = oldPath.substringBeforeLast('/', "")
        val targetPath = if (parent.isEmpty()) newName else "$parent/$newName"
        viewModelScope.launch(dispatchers.io) {
            val res = repository.performFileOperation("rename", oldPath, targetPath)
            withContext(dispatchers.main) {
                if (res.isSuccess) {
                    showToast("Renamed successfully")
                    loadFolder(currentFolder)
                } else {
                    showToast("Rename failed: ${res.exceptionOrNull()?.message}")
                }
            }
        }
    }

    fun deleteFile(path: String) {
        viewModelScope.launch(dispatchers.io) {
            val res = repository.performFileOperation("delete", path)
            withContext(dispatchers.main) {
                if (res.isSuccess) {
                    showToast("Deleted $path")
                    loadFolder(currentFolder)
                } else {
                    showToast("Delete failed: ${res.exceptionOrNull()?.message}")
                }
            }
        }
    }

    fun clearLocalData() {
        repository.connectionStore.clearAllData()
        repository.chatStorage.clearHistory()
        disconnect()
        showToast("All local data and saved profiles cleared")
    }
}

class MiniOViewModelFactory(
    private val context: Context
) : ViewModelProvider.Factory {
    override fun <T : ViewModel> create(modelClass: Class<T>): T {
        val store = ConnectionStore(context)
        val chatStorage = ChatStorage(context)
        val dispatchers = DefaultDispatchersProvider()
        val repo = MiniORepository(store, chatStorage, dispatchers)
        @Suppress("UNCHECKED_CAST")
        val vm = MiniOViewModel(repo, dispatchers)
        vm.taskNotificationManager = TaskNotificationManager(context)
        return vm as T
    }
}

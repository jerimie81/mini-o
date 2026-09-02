package com.minio.mobile.viewmodel

import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.minio.mobile.data.*
import com.minio.mobile.voice.VoiceAssistantManager
import com.minio.mobile.voice.VoiceState
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

class MiniOViewModel : ViewModel() {
    var connectionProfiles by mutableStateOf<List<ConnectionProfile>>(emptyList()); private set
    var activeConnectionId by mutableStateOf<String?>(null); private set
    var connection by mutableStateOf<Connection?>(null); private set
    var isConnected by mutableStateOf(false); private set
    var isConnecting by mutableStateOf(false); private set
    var connectionError by mutableStateOf<String?>(null); private set

    var currentTab by mutableStateOf(ScreenTab.CHAT)
    var notificationMessage by mutableStateOf<String?>(null); private set

    // Voice State
    var voiceState by mutableStateOf(VoiceState.IDLE)
    var voiceRmsDb by mutableStateOf(0f)
    var isVoiceOutputEnabled by mutableStateOf(true)
    var wasLastInputVoice by mutableStateOf(false); private set
    var voiceAssistantManager: VoiceAssistantManager? = null

    // Server Info
    var health by mutableStateOf<ServerHealth?>(null); private set
    var platform by mutableStateOf<PlatformInfo?>(null); private set
    var diagnostics by mutableStateOf<DiagnosticInfo?>(null); private set
    var availableModels by mutableStateOf<List<ModelInfo>>(emptyList()); private set
    var selectedModel by mutableStateOf("minimax-m3:cloud")

    // Chat State
    var chatMessages by mutableStateOf<List<ChatMessage>>(
        listOf(
            ChatMessage(
                role = "assistant",
                content = "Welcome to **Mini-O Mobile**! I am connected to your local AI workspace on your PC. You can chat, view files, test prompts, and edit `AGENT.md`."
            )
        )
    ); private set
    var chatInput by mutableStateOf("")
    var isChatStreaming by mutableStateOf(false); private set
    var activeToolNotification by mutableStateOf<String?>(null); private set
    private var streamingJob: Job? = null

    // Workspace & Files State
    var currentFolder by mutableStateOf(".")
    var fileItems by mutableStateOf<List<FileItem>>(emptyList()); private set
    var fileSearchQuery by mutableStateOf("")
    var isFilesLoading by mutableStateOf(false); private set
    var filesError by mutableStateOf<String?>(null); private set

    // File Editor State
    var activeFilePath by mutableStateOf<String?>(null); private set
    var editorOriginalContent by mutableStateOf(""); private set
    var editorText by mutableStateOf("")
    var editorModifiedTimestamp by mutableStateOf<Double?>(null); private set
    var isEditorReadOnly by mutableStateOf(false)
    var isSavingFile by mutableStateOf(false); private set
    var isEditorLoading by mutableStateOf(false); private set

    private var apiClient: MiniOApiClient? = null

    fun showToast(msg: String) {
        notificationMessage = msg
    }

    fun clearToast() {
        notificationMessage = null
    }

    fun connect(url: String, token: String, name: String = "Default", onConnected: (Connection) -> Unit) {
        val normalizedUrl = url.trim().removeSuffix("/")
        if (!normalizedUrl.startsWith("http://") && !normalizedUrl.startsWith("https://")) {
            connectionError = "Please enter a valid URL starting with http:// or https://"
            return
        }

        isConnecting = true
        connectionError = null

        viewModelScope.launch(Dispatchers.IO) {
            val conn = Connection(normalizedUrl, token.trim())
            val client = MiniOApiClientImpl(conn)
            val healthRes = client.checkHealth()

            if (healthRes.isSuccess) {
                val h = healthRes.getOrNull()
                val platRes = client.getPlatform()
                val modelsRes = client.getModels()

                withContext(Dispatchers.Main) {
                    val profile = ConnectionProfile(name = name, url = normalizedUrl, token = token.trim())
                    connectionProfiles = (connectionProfiles.filter { it.url != normalizedUrl } + profile)
                    activeConnectionId = profile.id
                    connection = conn
                    apiClient = client
                    isConnected = true
                    health = h
                    platform = platRes.getOrNull()
                    val models = modelsRes.getOrNull() ?: emptyList()
                    availableModels = models
                    if (models.isNotEmpty()) {
                        selectedModel = models.first().name
                    }
                    isConnecting = false
                    onConnected(conn)
                    loadFolder(".")
                    refreshDiagnostics()
                }
            } else {
                withContext(Dispatchers.Main) {
                    connectionError = healthRes.exceptionOrNull()?.message ?: "Could not connect to Mini-O server"
                    isConnecting = false
                }
            }
        }
    }

    fun disconnect(profileId: String? = null) {
        if (profileId != null && activeConnectionId != profileId) return
        streamingJob?.cancel()
        apiClient = null
        connection = null
        isConnected = false
        activeConnectionId = null
        fileItems = emptyList()
        activeFilePath = null
        isChatStreaming = false
    }

    fun switchProfile(profileId: String) {
        val profile = connectionProfiles.find { it.id == profileId } ?: return
        disconnect()
        connect(profile.url, profile.token, profile.name) { _ -> }
    }

    fun pingServer() {
        val client = apiClient ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val res = client.checkHealth()
            withContext(Dispatchers.Main) {
                if (res.isSuccess) {
                    showToast("Server is reachable")
                } else {
                    showToast("Server unreachable: ${res.exceptionOrNull()?.message}")
                }
            }
        }
    }

    fun refreshDiagnostics() {
        val client = apiClient ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val diagRes = client.getDiagnostics()
            val platRes = client.getPlatform()
            val modRes = client.getModels()
            withContext(Dispatchers.Main) {
                diagnostics = diagRes.getOrNull()
                platform = platRes.getOrNull()
                if (modRes.isSuccess) {
                    availableModels = modRes.getOrNull() ?: emptyList()
                }
            }
        }
    }

    // Chat Operations
    fun sendChatMessage(promptText: String = chatInput, fromVoice: Boolean = false) {
        val prompt = promptText.trim()
        if (prompt.isEmpty() || isChatStreaming) return
        val client = apiClient ?: return

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

        chatMessages = chatMessages + userMessage + initialAssistantMessage
        chatInput = ""
        isChatStreaming = true
        activeToolNotification = null

        val historyForApi = chatMessages.filter { it.id != assistantMessageId }

        streamingJob = viewModelScope.launch(Dispatchers.IO) {
            client.streamChat(
                model = selectedModel,
                messages = historyForApi,
                conversationId = null,
                useTools = true,
                onToken = { tokenChunk ->
                    viewModelScope.launch(Dispatchers.Main) {
                        chatMessages = chatMessages.map { msg ->
                            if (msg.id == assistantMessageId) {
                                msg.copy(content = msg.content + tokenChunk)
                            } else msg
                        }
                    }
                },
                onToolCall = { name, _ ->
                    viewModelScope.launch(Dispatchers.Main) {
                        activeToolNotification = "Running tool: $name"
                    }
                },
                onToolResult = { name, _ ->
                    viewModelScope.launch(Dispatchers.Main) {
                        activeToolNotification = "Tool $name finished"
                    }
                },
                onDone = {
                    viewModelScope.launch(Dispatchers.Main) {
                        var finalAssistantText = ""
                        chatMessages = chatMessages.map { msg ->
                            if (msg.id == assistantMessageId) {
                                finalAssistantText = msg.content
                                msg.copy(isStreaming = false)
                            } else msg
                        }
                        isChatStreaming = false
                        activeToolNotification = null

                        // Auto speak response when prompt was triggered by voice
                        if (wasLastInputVoice && isVoiceOutputEnabled && finalAssistantText.isNotBlank()) {
                            voiceAssistantManager?.speak(finalAssistantText)
                        }
                    }
                },
                onError = { err ->
                    viewModelScope.launch(Dispatchers.Main) {
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

                        if (wasLastInputVoice && isVoiceOutputEnabled) {
                            voiceAssistantManager?.speak("Sorry, an error occurred while generating a response.")
                        }
                    }
                }
            )
        }
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

    fun clearChat() {
        stopChatGeneration()
        chatMessages = listOf(
            ChatMessage(
                role = "assistant",
                content = "Conversation cleared. Ready for your next request."
            )
        )
    }

    // Workspace & File Operations
    fun loadFolder(path: String = currentFolder) {
        val client = apiClient ?: return
        isFilesLoading = true
        filesError = null

        viewModelScope.launch(Dispatchers.IO) {
            val res = client.listFiles(path, fileSearchQuery)
            withContext(Dispatchers.Main) {
                isFilesLoading = false
                if (res.isSuccess) {
                    currentFolder = path
                    fileItems = res.getOrNull() ?: emptyList()
                } else {
                    filesError = res.exceptionOrNull()?.message ?: "Failed to list folder"
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
        val client = apiClient ?: return
        isEditorLoading = true
        activeFilePath = filePath

        viewModelScope.launch(Dispatchers.IO) {
            val res = client.getFileContent(filePath)
            withContext(Dispatchers.Main) {
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
        val client = apiClient ?: return
        isSavingFile = true

        viewModelScope.launch(Dispatchers.IO) {
            val res = client.saveFileContent(path, editorText, editorModifiedTimestamp)
            withContext(Dispatchers.Main) {
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
        showToast("Reverted to original file content")
    }

    fun closeEditor() {
        activeFilePath = null
        editorText = ""
        editorOriginalContent = ""
    }

    fun createNewFile(fileName: String, initialContent: String = "") {
        val client = apiClient ?: return
        val targetPath = if (currentFolder == ".") fileName.trim() else "$currentFolder/${fileName.trim()}"

        viewModelScope.launch(Dispatchers.IO) {
            val res = client.saveFileContent(targetPath, initialContent)
            withContext(Dispatchers.Main) {
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

    fun deleteFile(path: String) {
        val client = apiClient ?: return
        viewModelScope.launch(Dispatchers.IO) {
            val res = client.performFileOperation("delete", path)
            withContext(Dispatchers.Main) {
                if (res.isSuccess) {
                    showToast("Deleted $path")
                    loadFolder(currentFolder)
                } else {
                    showToast("Delete failed: ${res.exceptionOrNull()?.message}")
                }
            }
        }
    }
}

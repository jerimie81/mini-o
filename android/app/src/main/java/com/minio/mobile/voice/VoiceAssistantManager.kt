package com.minio.mobile.voice

import android.content.Context
import android.content.Intent
import android.os.Bundle
import android.speech.RecognitionListener
import android.speech.RecognizerIntent
import android.speech.SpeechRecognizer
import android.speech.tts.TextToSpeech
import android.speech.tts.UtteranceProgressListener
import java.util.Locale

enum class VoiceState {
    IDLE,
    LISTENING,
    PROCESSING,
    SPEAKING
}

class VoiceAssistantManager(
    private val context: Context,
    private val onStateChanged: (VoiceState) -> Unit,
    private val onRmsChanged: (Float) -> Unit,
    private val onSpeechResult: (String) -> Unit,
    private val onError: (String) -> Unit
) {
    private var speechRecognizer: SpeechRecognizer? = null
    private var textToSpeech: TextToSpeech? = null
    private var isTtsReady = false

    var currentState: VoiceState = VoiceState.IDLE
        private set(value) {
            field = value
            onStateChanged(value)
        }

    init {
        initTts()
    }

    private fun initTts() {
        textToSpeech = TextToSpeech(context) { status ->
            if (status == TextToSpeech.SUCCESS) {
                val res = textToSpeech?.setLanguage(Locale.getDefault())
                isTtsReady = res != TextToSpeech.LANG_MISSING_DATA && res != TextToSpeech.LANG_NOT_SUPPORTED
                if (isTtsReady) {
                    textToSpeech?.setSpeechRate(1.05f)
                    textToSpeech?.setPitch(1.0f)
                    textToSpeech?.setOnUtteranceProgressListener(object : UtteranceProgressListener() {
                        override fun onStart(utteranceId: String?) {
                            currentState = VoiceState.SPEAKING
                        }

                        override fun onDone(utteranceId: String?) {
                            if (currentState == VoiceState.SPEAKING) {
                                currentState = VoiceState.IDLE
                            }
                        }

                        override fun onError(utteranceId: String?, errorCode: Int) {
                            if (currentState == VoiceState.SPEAKING) {
                                currentState = VoiceState.IDLE
                            }
                        }
                    })
                }
            }
        }
    }

    fun startListening() {
        stopSpeaking()

        if (!SpeechRecognizer.isRecognitionAvailable(context)) {
            onError("Speech recognition is not available on this device.")
            currentState = VoiceState.IDLE
            return
        }

        try {
            speechRecognizer?.destroy()
            speechRecognizer = SpeechRecognizer.createSpeechRecognizer(context).apply {
                setRecognitionListener(object : RecognitionListener {
                    override fun onReadyForSpeech(params: Bundle?) {
                        currentState = VoiceState.LISTENING
                    }

                    override fun onBeginningOfSpeech() {
                        currentState = VoiceState.LISTENING
                    }

                    override fun onRmsChanged(rmsdB: Float) {
                        onRmsChanged(rmsdB)
                    }

                    override fun onBufferReceived(buffer: ByteArray?) {}

                    override fun onEndOfSpeech() {
                        currentState = VoiceState.PROCESSING
                    }

                    override fun onError(error: Int) {
                        val message = when (error) {
                            SpeechRecognizer.ERROR_AUDIO -> "Audio recording error"
                            SpeechRecognizer.ERROR_CLIENT -> "Client-side voice error"
                            SpeechRecognizer.ERROR_INSUFFICIENT_PERMISSIONS -> "Microphone permission required"
                            SpeechRecognizer.ERROR_NETWORK -> "Network error during recognition"
                            SpeechRecognizer.ERROR_NETWORK_TIMEOUT -> "Network timeout"
                            SpeechRecognizer.ERROR_NO_MATCH -> "No speech recognized. Try again."
                            SpeechRecognizer.ERROR_RECOGNIZER_BUSY -> "Voice recognizer is busy"
                            SpeechRecognizer.ERROR_SERVER -> "Voice server error"
                            SpeechRecognizer.ERROR_SPEECH_TIMEOUT -> "No speech detected"
                            else -> "Recognition error ($error)"
                        }
                        currentState = VoiceState.IDLE
                        if (error != SpeechRecognizer.ERROR_NO_MATCH && error != SpeechRecognizer.ERROR_SPEECH_TIMEOUT) {
                            onError(message)
                        }
                    }

                    override fun onResults(results: Bundle?) {
                        val matches = results?.getStringArrayList(SpeechRecognizer.RESULTS_RECOGNITION)
                        val text = matches?.firstOrNull()?.trim()
                        if (!text.isNullOrEmpty()) {
                            currentState = VoiceState.PROCESSING
                            onSpeechResult(text)
                        } else {
                            currentState = VoiceState.IDLE
                        }
                    }

                    override fun onPartialResults(partialResults: Bundle?) {}
                    override fun onEvent(eventType: Int, params: Bundle?) {}
                })
            }

            val intent = Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
                putExtra(RecognizerIntent.EXTRA_LANGUAGE_MODEL, RecognizerIntent.LANGUAGE_MODEL_FREE_FORM)
                putExtra(RecognizerIntent.EXTRA_LANGUAGE, Locale.getDefault())
                putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, true)
                putExtra(RecognizerIntent.EXTRA_MAX_RESULTS, 1)
            }

            speechRecognizer?.startListening(intent)
            currentState = VoiceState.LISTENING
        } catch (e: Exception) {
            currentState = VoiceState.IDLE
            onError(e.message ?: "Failed to start listening")
        }
    }

    fun stopListening() {
        try {
            speechRecognizer?.stopListening()
        } catch (_: Exception) {}
        if (currentState == VoiceState.LISTENING) {
            currentState = VoiceState.PROCESSING
        }
    }

    fun cancelListening() {
        try {
            speechRecognizer?.cancel()
        } catch (_: Exception) {}
        currentState = VoiceState.IDLE
    }

    fun speak(text: String) {
        if (!isTtsReady || textToSpeech == null) {
            return
        }

        val cleanedText = cleanMarkdownForSpeech(text)
        if (cleanedText.isBlank()) return

        stopSpeaking()
        currentState = VoiceState.SPEAKING

        val params = Bundle().apply {
            putString(TextToSpeech.Engine.KEY_PARAM_UTTERANCE_ID, "mini_o_reply_${System.currentTimeMillis()}")
        }
        textToSpeech?.speak(cleanedText, TextToSpeech.QUEUE_FLUSH, params, "mini_o_reply")
    }

    fun stopSpeaking() {
        if (currentState == VoiceState.SPEAKING) {
            textToSpeech?.stop()
            currentState = VoiceState.IDLE
        }
    }

    fun destroy() {
        try {
            speechRecognizer?.destroy()
            speechRecognizer = null
            textToSpeech?.stop()
            textToSpeech?.shutdown()
            textToSpeech = null
        } catch (_: Exception) {}
    }

    companion object {
        fun cleanMarkdownForSpeech(raw: String): String {
            var text = raw
            text = text.replace(Regex("```[a-zA-Z0-9_-]*\\n[\\s\\S]*?```"), " Here is the code snippet. ")
            text = text.replace(Regex("`([^`]+)`"), "$1")
            text = text.replace(Regex("\\[([^\\]]+)\\]\\([^\\)]+\\)"), "$1")
            text = text.replace(Regex("^#+\\s*", RegexOption.MULTILINE), "")
            text = text.replace(Regex("^[\\s]*[-*+]\\s+", RegexOption.MULTILINE), "")
            text = text.replace(Regex("[*_]{1,3}"), "")
            text = text.replace(Regex("^>+\\s*", RegexOption.MULTILINE), "")
            text = text.replace(Regex("\\n{2,}"), ". ")
            text = text.replace(Regex("\\n"), " ")
            text = text.replace(Regex("\\s{2,}"), " ").trim()
            return text
        }
    }
}

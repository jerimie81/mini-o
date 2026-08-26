package com.minio.mcp

import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.ui.Messages

class SendSelectionAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        val editor = event.getData(CommonDataKeys.EDITOR) ?: return
        val text = editor.selectionModel.selectedText
        if (text.isNullOrBlank()) {
            Messages.showInfoMessage("Select editor text first.", "Mini-O MCP")
            return
        }
        try {
            val client = MiniOMcpClient()
            client.initialize()
            val response = client.sendSelection("editor", text)
            Messages.showInfoMessage(response.take(2000), "Mini-O MCP")
        } catch (error: Exception) {
            Messages.showErrorDialog(error.message ?: "MCP request failed", "Mini-O MCP")
        }
    }
}

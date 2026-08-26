const vscode = require("vscode");

let initialized = false;

async function rawMcpRequest(method, params = {}) {
  const base = vscode.workspace.getConfiguration("mini-o").get("endpoint", "http://127.0.0.1:8000/api/mcp");
  const response = await fetch(base, { method: "POST", headers: { "content-type": "application/json", "MCP-Protocol-Version": "2025-11-25" }, body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params }) });
  if (!response.ok) throw new Error(`Mini-O MCP request failed (${response.status})`);
  const result = await response.json(); if (result.error) throw new Error(result.error.message); return result.result;
}

async function mcpRequest(method, params = {}) {
  if (method !== "initialize" && !initialized) {
    await rawMcpRequest("initialize", { protocolVersion: "2025-11-25", capabilities: {}, clientInfo: { name: "mini-o-vscode", version: "0.1.0" } });
    initialized = true;
  }
  return rawMcpRequest(method, params);
}

function activate(context) {
  const output = vscode.window.createOutputChannel("Mini-O MCP");
  context.subscriptions.push(vscode.commands.registerCommand("mini-o.listTools", async () => {
    try { const result = await mcpRequest("tools/list"); output.clear(); output.appendLine(JSON.stringify(result, null, 2)); output.show(); }
    catch (error) { vscode.window.showErrorMessage(`Mini-O: ${error.message}`); }
  }));
  context.subscriptions.push(vscode.commands.registerCommand("mini-o.sendSelection", async () => {
    const editor = vscode.window.activeTextEditor; const selection = editor?.document.getText(editor.selection);
    if (!selection) return vscode.window.showInformationMessage("Select text before sending context to Mini-O.");
    try { await mcpRequest("context/submit", { client_id: "vscode", items: [{ kind: "selection", label: editor.document.fileName, text: selection }] }); vscode.window.showInformationMessage("Mini-O received the selection context."); }
    catch (error) { vscode.window.showErrorMessage(`Mini-O: ${error.message}`); }
  }));
}
function deactivate() {}
module.exports = { activate, deactivate };

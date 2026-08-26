#!/usr/bin/env python3
"""Small dependency-free Mini-O MCP client for scripts and terminal use."""
import argparse
import json
import subprocess
import sys
import urllib.request

class McpClient:
    def __init__(self, url="http://127.0.0.1:8000/api/mcp", token=None, stdio=False):
        self.url, self.token, self.stdio, self.process, self.request_id = url, token, stdio, None, 0
        if stdio: self.process = subprocess.Popen([sys.executable, "-m", "backend.mcp_stdio"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, text=True)

    def request(self, method, params=None):
        self.request_id += 1
        message = {"jsonrpc": "2.0", "id": self.request_id, "method": method}
        if params is not None: message["params"] = params
        if self.stdio:
            self.process.stdin.write(json.dumps(message) + "\n"); self.process.stdin.flush()
            return json.loads(self.process.stdout.readline())
        body = json.dumps(message).encode()
        headers = {"content-type": "application/json", "MCP-Protocol-Version": "2025-11-25"}
        if self.token: headers["authorization"] = f"Bearer {self.token}"
        request = urllib.request.Request(self.url, data=body, headers=headers, method="POST")
        with urllib.request.urlopen(request, timeout=30) as response: return json.loads(response.read())

    def close(self):
        if self.process: self.process.terminate()

def main():
    parser = argparse.ArgumentParser(description="Mini-O MCP client")
    parser.add_argument("--url", default="http://127.0.0.1:8000/api/mcp")
    parser.add_argument("--token")
    parser.add_argument("--stdio", action="store_true")
    sub = parser.add_subparsers(dest="command", required=True)
    sub.add_parser("init"); sub.add_parser("tools"); sub.add_parser("resources")
    read = sub.add_parser("read"); read.add_argument("uri")
    call = sub.add_parser("call"); call.add_argument("name"); call.add_argument("--args", default="{}")
    context = sub.add_parser("context"); context.add_argument("text"); context.add_argument("--label", default="selection")
    args = parser.parse_args(); client = McpClient(args.url, args.token, args.stdio)
    try:
        client.request("initialize", {"protocolVersion": "2025-11-25", "capabilities": {}})
        if args.command == "init": result = {"initialized": True}
        elif args.command == "tools": result = client.request("tools/list")
        elif args.command == "resources": result = client.request("resources/list")
        elif args.command == "read": result = client.request("resources/read", {"uri": args.uri})
        elif args.command == "call": result = client.request("tools/call", {"name": args.name, "arguments": json.loads(args.args)})
        else: result = client.request("context/submit", {"client_id": "mini-o-cli", "items": [{"kind": "selection", "label": args.label, "text": args.text}]})
        print(json.dumps(result, indent=2))
    finally: client.close()

if __name__ == "__main__": main()

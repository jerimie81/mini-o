' Mini-O Silent Launcher for Windows
' Runs the background node server without a lingering console window
Dim WshShell, fso, scriptDir, cmd

Set WshShell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
scriptDir = fso.GetParentFolderName(WScript.ScriptFullName)

cmd = "cmd.exe /c cd /d """ & scriptDir & """ && call mini-o.cmd open"
WshShell.Run cmd, 0, False

Set WshShell = Nothing
Set fso = Nothing

' Windowsタスクスケジューラから .cmd を起動する際にコマンドプロンプトの窓が
' 表示されてしまう問題を避けるための非表示ラッパー。
' 使い方: wscript.exe run-hidden.vbs "対象の.cmdへのフルパス"
Set objShell = CreateObject("WScript.Shell")
objShell.Run """" & WScript.Arguments(0) & """", 0, True

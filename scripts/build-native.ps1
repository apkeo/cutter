$ErrorActionPreference = 'Stop'
$taskRoot = Split-Path $PSScriptRoot -Parent
$nativeOutput = Join-Path $taskRoot 'dist/native'
New-Item -ItemType Directory -Path $nativeOutput -Force | Out-Null
$temporaryBinary = Join-Path $nativeOutput ('cursor-' + [guid]::NewGuid().ToString() + '.exe')
Add-Type -Path (Join-Path $taskRoot 'native/cursor-windows.cs') -OutputAssembly $temporaryBinary -OutputType ConsoleApplication -ReferencedAssemblies System.Windows.Forms.dll
Move-Item -LiteralPath $temporaryBinary -Destination (Join-Path $nativeOutput 'cursor-helper.exe') -Force

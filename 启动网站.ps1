$ErrorActionPreference = "Stop"

$siteDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$siteUrl = "http://127.0.0.1:8765/"
$stdoutLog = Join-Path $siteDir "local_server.stdout.log"
$stderrLog = Join-Path $siteDir "local_server.stderr.log"

function Test-LocalSite {
    try {
        $response = Invoke-WebRequest -Uri $siteUrl -UseBasicParsing -TimeoutSec 1
        return $response.StatusCode -eq 200
    }
    catch {
        return $false
    }
}

function Show-LaunchError([string]$message) {
    Add-Type -AssemblyName PresentationFramework
    [System.Windows.MessageBox]::Show(
        $message,
        "JV-EQE Workbench startup failed",
        [System.Windows.MessageBoxButton]::OK,
        [System.Windows.MessageBoxImage]::Error
    ) | Out-Null
}

try {
    if (-not (Test-LocalSite)) {
        $codexPython = Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
        if (Test-Path -LiteralPath $codexPython) {
            $pythonExe = $codexPython
            $pythonArguments = @("local_server.py")
        }
        else {
            $launcher = Get-Command py.exe -ErrorAction SilentlyContinue
            if (-not $launcher) {
                throw "Python was not found. Install 64-bit Python 3.12 or run this project from Codex."
            }
            $pythonExe = $launcher.Source
            $pythonArguments = @("-3", "local_server.py")
        }

        Start-Process `
            -FilePath $pythonExe `
            -ArgumentList $pythonArguments `
            -WorkingDirectory $siteDir `
            -WindowStyle Hidden `
            -RedirectStandardOutput $stdoutLog `
            -RedirectStandardError $stderrLog

        $started = $false
        for ($attempt = 0; $attempt -lt 40; $attempt++) {
            Start-Sleep -Milliseconds 250
            if (Test-LocalSite) {
                $started = $true
                break
            }
        }

        if (-not $started) {
            $detail = ""
            if (Test-Path -LiteralPath $stderrLog) {
                $detail = (Get-Content -LiteralPath $stderrLog -Tail 20 -ErrorAction SilentlyContinue) -join "`n"
            }
            throw "The local service did not start within 10 seconds.`n$detail"
        }
    }

    $version = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
    Start-Process ($siteUrl + "?v=" + $version)
}
catch {
    Show-LaunchError $_.Exception.Message
}

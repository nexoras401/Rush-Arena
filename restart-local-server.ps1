$ErrorActionPreference = 'Stop'
$siteRoot = 'C:\Downloaded Web Sites\megarenabrasil.com'
$listeners = @(Get-NetTCPConnection -LocalAddress '127.0.0.1' -LocalPort 8766 -State Listen -ErrorAction SilentlyContinue)
foreach ($listener in $listeners) {
    $serverProcess = Get-CimInstance Win32_Process -Filter "ProcessId=$($listener.OwningProcess)"
    if ($serverProcess.CommandLine -notmatch 'backend\.py' -or $serverProcess.Name -notmatch '^python(w)?\.exe$') {
        throw 'A porta 8766 pertence a outro processo; nenhum processo foi encerrado.'
    }
    Write-Output ('Reiniciando backend.py, PID ' + $serverProcess.ProcessId)
    Stop-Process -Id $serverProcess.ProcessId
    Wait-Process -Id $serverProcess.ProcessId -ErrorAction SilentlyContinue -Timeout 10
}
$startInfo = New-Object System.Diagnostics.ProcessStartInfo
$startInfo.FileName = 'C:\Users\Administrator\AppData\Local\Programs\Python\Launcher\py.exe'
$startInfo.Arguments = '-3 backend.py'
$startInfo.WorkingDirectory = $siteRoot
$startInfo.UseShellExecute = $true
$startInfo.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$server = New-Object System.Diagnostics.Process
$server.StartInfo = $startInfo
[void]$server.Start()
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 300
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8766/api/health' -TimeoutSec 2
        if ($health.ok) { Write-Output ($health | ConvertTo-Json -Compress); exit 0 }
    } catch {}
}
throw 'Servidor não respondeu ao teste de saúde.'

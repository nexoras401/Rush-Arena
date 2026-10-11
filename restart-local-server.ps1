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
$env:RUSH_HOST = '127.0.0.1'
$env:RUSH_PORT = '8766'
Start-Process -FilePath 'py.exe' -ArgumentList '-3','backend.py' -WorkingDirectory $siteRoot -WindowStyle Hidden -RedirectStandardOutput "$siteRoot\data\server-out.log" -RedirectStandardError "$siteRoot\data\server-error.log"
for ($attempt = 0; $attempt -lt 20; $attempt++) {
    Start-Sleep -Milliseconds 300
    try {
        $health = Invoke-RestMethod 'http://127.0.0.1:8766/api/health' -TimeoutSec 2
        if ($health.ok) { Write-Output ($health | ConvertTo-Json -Compress); exit 0 }
    } catch {}
}
throw 'Servidor não respondeu ao teste de saúde.'

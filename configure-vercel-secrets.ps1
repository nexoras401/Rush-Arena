$ErrorActionPreference = "Stop"
Set-Location -LiteralPath $PSScriptRoot

Write-Host "Configuracao segura da VulcanoPay na Vercel" -ForegroundColor Cyan
Write-Host "Os valores serao lidos da area de transferencia e apagados logo depois."

function Read-ClipboardSecret {
    param([string]$Prompt)
    Read-Host $Prompt | Out-Null
    for ($attempt = 1; $attempt -le 12; $attempt++) {
        try {
            $value = Get-Clipboard -Raw -ErrorAction Stop
            if (-not [string]::IsNullOrWhiteSpace($value)) {
                return $value.Trim()
            }
        }
        catch {
            Start-Sleep -Milliseconds 250
        }
    }
    throw "Nao foi possivel ler a area de transferencia. Copie novamente e repita o script."
}

$apiValue = Read-ClipboardSecret "Copie a chave VulcanoPay completa (vk_test_...) e pressione ENTER"
Set-Clipboard -Value " "

$hookValue = Read-ClipboardSecret "Copie o segredo completo do webhook (whsec_...) e pressione ENTER"
Set-Clipboard -Value " "

try {
    if ($apiValue -notmatch '^vk_(test|live)_[A-Za-z0-9_-]+$') { throw "Chave da API invalida." }
    if ($hookValue -notmatch '^whsec_[A-Za-z0-9_-]+$') { throw "Segredo do webhook invalido." }

    $apiValue | pnpm.cmd dlx vercel@62.0.0 env add VULCANO_API_KEY production --force
    $hookValue | pnpm.cmd dlx vercel@62.0.0 env add VULCANO_WEBHOOK_SECRET production --force
    "https://api.vulcanopay.com/v1" | pnpm.cmd dlx vercel@62.0.0 env add VULCANO_API_URL production --force

    Write-Host "Segredos adicionados. Publicando a configuracao..." -ForegroundColor Green
    pnpm.cmd dlx vercel@62.0.0 deploy --prod --yes
}
finally {
    Set-Clipboard -Value " "
    $apiValue = $null
    $hookValue = $null
}

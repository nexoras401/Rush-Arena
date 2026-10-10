$ErrorActionPreference = "Stop"

Set-Location -LiteralPath $PSScriptRoot

Write-Host "Rush Arena + VulcanoPay" -ForegroundColor Cyan
Write-Host "Cole os segredos abaixo. Eles ficarao ocultos e nao serao gravados em arquivo."

$apiSecure = Read-Host "Chave da API (vk_test_... ou vk_live_...)" -AsSecureString
$webhookSecure = Read-Host "Segredo do webhook (whsec_...)" -AsSecureString

$apiPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($apiSecure)
$webhookPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($webhookSecure)

try {
    $env:VULCANO_API_KEY = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($apiPointer)
    $env:VULCANO_WEBHOOK_SECRET = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($webhookPointer)
    $env:VULCANO_API_URL = "https://api.vulcanopay.com/v1"
    $env:RUSH_HOST = "127.0.0.1"
    $env:RUSH_PORT = "8766"

    if ($env:VULCANO_API_KEY -notmatch '^vk_(test|live)_[A-Za-z0-9_-]+$') {
        throw "A chave precisa comecar com vk_test_ ou vk_live_."
    }
    if ($env:VULCANO_WEBHOOK_SECRET -notmatch '^whsec_[A-Za-z0-9_-]+$') {
        throw "O segredo do webhook precisa comecar com whsec_."
    }

    Write-Host "Iniciando em http://127.0.0.1:8766" -ForegroundColor Green
    Write-Host "Fechar esta janela encerra o backend e remove os segredos da memoria."
    & py -3 backend.py
}
finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($apiPointer)
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($webhookPointer)
    Remove-Item Env:VULCANO_API_KEY -ErrorAction SilentlyContinue
    Remove-Item Env:VULCANO_WEBHOOK_SECRET -ErrorAction SilentlyContinue
}

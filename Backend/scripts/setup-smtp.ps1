$ErrorActionPreference = 'Stop'
$smtpHostName = Read-Host 'SMTP host supplied by your provider'
$smtpPortText = Read-Host 'SMTP port (587 for STARTTLS, 465 for implicit TLS)'
$smtpPortNumber = 0
if (-not [int]::TryParse($smtpPortText, [ref]$smtpPortNumber) -or $smtpPortNumber -notin @(465, 587)) {
    throw 'Enter port 465 or 587. Use the setting supplied by your provider.'
}
$senderAddress = Read-Host 'Authorized sender email address'
$smtpLoginName = Read-Host 'SMTP username supplied by your provider'
$smtpSecret = Read-Host 'SMTP password / app password / SMTP credential (hidden)' -AsSecureString
$secretPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($smtpSecret)
try {
    $payload = @{
        host = $smtpHostName.Trim()
        port = $smtpPortNumber
        secure = ($smtpPortNumber -eq 465)
        from = $senderAddress.Trim()
        user = $smtpLoginName
        password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($secretPointer)
    }
    $payload | ConvertTo-Json -Compress | node (Join-Path $PSScriptRoot 'setup-smtp.mjs')
    if ($LASTEXITCODE -ne 0) { throw 'SMTP setup failed; the existing configuration was preserved.' }
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($secretPointer)
    if ($payload) { $payload.password = $null }
    $smtpSecret.Dispose()
}

param([ValidateSet('Protect','Unprotect')][string]$Mode)
$ErrorActionPreference = 'Stop'
try {
    Add-Type -AssemblyName System.Security
    $payload = [Convert]::FromBase64String([Console]::In.ReadToEnd().Trim())
    $entropy = [Text.Encoding]::UTF8.GetBytes('RhineMusic.NetEase.Session.v1')
    $scope = [Security.Cryptography.DataProtectionScope]::CurrentUser
    if ($Mode -eq 'Protect') {
        $result = [Security.Cryptography.ProtectedData]::Protect($payload, $entropy, $scope)
    } else {
        $result = [Security.Cryptography.ProtectedData]::Unprotect($payload, $entropy, $scope)
    }
    [Console]::Out.Write([Convert]::ToBase64String($result))
} catch {
    [Console]::Error.Write('Windows could not protect or restore the session.')
    exit 1
}

param([string]$ServerHost = '192.168.0.25')
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$parsedAddress = $null
if (-not [System.Net.IPAddress]::TryParse($ServerHost, [ref]$parsedAddress) -or $parsedAddress.AddressFamily -ne [System.Net.Sockets.AddressFamily]::InterNetwork) {
    throw 'ServerHost must be an IPv4 address reachable by the 3DS.'
}
docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running.' }
docker run --rm -v "${projectRoot}:/project" -w /project/client devkitpro/devkitarm:latest make clean
if ($LASTEXITCODE -ne 0) { throw '3DS client clean failed.' }
docker run --rm -v "${projectRoot}:/project" -w /project/client devkitpro/devkitarm:latest make -j2 "SERVER_HOST=$ServerHost"
if ($LASTEXITCODE -ne 0) { throw '3DS client build failed.' }
$artifact = Join-Path $projectRoot 'client\emerald-online-3ds.3dsx'
if (-not (Test-Path -LiteralPath $artifact)) { throw 'Build returned without producing the expected .3dsx artifact.' }
Write-Host "Built $projectRoot\client\emerald-online-3ds.3dsx"

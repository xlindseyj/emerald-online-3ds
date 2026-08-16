param(
    [string]$RomPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'Pokemon - Emerald Version.gba'),
    [string]$ServerHost = 'live.emeraldonline3ds.com',
    [ValidateRange(1, 65535)][int]$ServerPort = 443,
    [ValidateSet('wss', 'tcp')][string]$Transport = 'wss',
    [string]$ServerPath = '/game',
    [string]$TrainerName = 'Trainer'
)
$ErrorActionPreference = 'Stop'
$projectRoot = Split-Path -Parent $PSScriptRoot
$deploy = Join-Path $projectRoot 'generated\sd-card\3ds\emerald-online-3ds'
$hostKind = [System.Uri]::CheckHostName($ServerHost)
if ($hostKind -ne [System.UriHostNameType]::IPv4 -and $hostKind -ne [System.UriHostNameType]::Dns) {
    throw 'ServerHost must be an IPv4 address or DNS hostname reachable by the 3DS.'
}
if ($ServerPath -notmatch '^/[A-Za-z0-9._~!$&''()*+,;=:@%/-]{0,126}$') { throw 'ServerPath must be a valid absolute WebSocket path.' }
if ($TrainerName -notmatch '^[\x20-!#-\[\]-~]{1,12}$') { throw 'TrainerName must be 1-12 printable characters without quotes or backslashes.' }
$romInspector = Join-Path $projectRoot 'tools\inspect-rom.mjs'
$romInfo = & node $romInspector $RomPath | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or -not $romInfo.supported) { throw 'The supplied ROM did not pass Emerald validation.' }

$avatarBuild = Join-Path $projectRoot 'generated\private-avatar-build'
& node (Join-Path $projectRoot 'tools\prepare-private-avatars.mjs') $RomPath $avatarBuild
if ($LASTEXITCODE -ne 0) { throw 'Private Emerald avatar preparation failed.' }

docker info *> $null
if ($LASTEXITCODE -ne 0) { throw 'Docker Desktop is not running.' }
$devkitImage = 'devkitpro/devkitarm@sha256:116afba8df8453961de2936ffab20dd441edf4d682856c1ec8b0e53d7ed0bbf5'
$packagingImage = 'mgba/3ds@sha256:2adee3ce361b86a4a92e6183fd3c59af614db7a7321d230ed46d7a3522efe4f4'
docker run --rm -e DEVKITPRO=/opt/devkitpro -e DEVKITARM=/opt/devkitpro/devkitARM -e CTRULIB=/opt/devkitpro/libctru -v "${projectRoot}\third_party\gpsp:/src" -w /src $devkitImage make platform=ctr -j8
if ($LASTEXITCODE -ne 0) { throw 'gpSP 3DS dynarec core build failed.' }
docker run --rm -e DEVKITPRO=/opt/devkitpro -e DEVKITARM=/opt/devkitpro/devkitARM -e CTRULIB=/opt/devkitpro/libctru -v "${projectRoot}:/project" -w /project/gpsp-runtime $devkitImage make -j8
if ($LASTEXITCODE -ne 0) { throw 'Dedicated gpSP frontend build failed.' }
docker run --rm -v "${projectRoot}:/project" -w /project/generated/private-avatar-build $devkitImage tex3ds -i avatars.t3s -o avatars.t3x
if ($LASTEXITCODE -ne 0) { throw 'Private Emerald avatar atlas build failed.' }
docker run --rm -v "${projectRoot}:/project" -w /project $packagingImage sh -lc "/opt/devkitpro/devkitARM/bin/arm-none-eabi-strip gpsp-runtime/emerald-online-3ds.elf -o gpsp-runtime/emerald-online-3ds-stripped.elf && /opt/devkitpro/tools/bin/bannertool makebanner -i assets/emerald-online-3ds-banner.png -a third_party/mgba/src/platform/3ds/bios.wav -o gpsp-runtime/emerald-online-3ds.bnr && /opt/devkitpro/tools/bin/makerom -f cia -o gpsp-runtime/emerald-online-3ds.cia -rsf third_party/mgba/src/platform/3ds/cia.rsf.in -target t -exefslogo -elf gpsp-runtime/emerald-online-3ds-stripped.elf -icon gpsp-runtime/emerald-online-3ds.smdh -banner gpsp-runtime/emerald-online-3ds.bnr -major 0 -minor 5 -micro 0"
if ($LASTEXITCODE -ne 0) { throw 'Dynarec CIA packaging failed.' }

$built = Join-Path $projectRoot 'gpsp-runtime\emerald-online-3ds.3dsx'
$builtCia = Join-Path $projectRoot 'gpsp-runtime\emerald-online-3ds.cia'
$client = Join-Path $projectRoot 'client\emerald-online-3ds.3dsx'
if (-not (Test-Path -LiteralPath $built) -or -not (Test-Path -LiteralPath $builtCia)) { throw 'Build did not produce both 3DSX and CIA artifacts.' }
Copy-Item -LiteralPath $built -Destination $client -Force
$release = Join-Path $projectRoot 'release'
New-Item -ItemType Directory -Path $release -Force | Out-Null
Copy-Item -LiteralPath $builtCia -Destination (Join-Path $release 'emerald-online-3ds.cia') -Force

New-Item -ItemType Directory -Path $deploy -Force | Out-Null
Copy-Item -LiteralPath $client -Destination (Join-Path $deploy 'emerald-online-3ds.3dsx') -Force
Copy-Item -LiteralPath $RomPath -Destination (Join-Path $deploy 'emerald.gba') -Force
Copy-Item -LiteralPath (Join-Path $avatarBuild 'avatars.t3x') -Destination (Join-Path $deploy 'avatars.t3x') -Force
$config = "server=$ServerHost`nport=$ServerPort`ntransport=$Transport`npath=$ServerPath`nname=$TrainerName`n"
[System.IO.File]::WriteAllText((Join-Path $deploy 'online.cfg'), $config, [System.Text.UTF8Encoding]::new($false))
Write-Host "Built runtime and private SD package at $deploy"

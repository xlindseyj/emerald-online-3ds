param(
    [string]$RomPath = (Join-Path (Split-Path -Parent $PSScriptRoot) 'Pokemon - Emerald Version.gba'),
    [string]$ServerHost = 'live.emeraldonline3ds.com',
    [ValidateRange(1, 65535)][int]$ServerPort = 443,
    [ValidateSet('wss', 'tcp')][string]$Transport = 'wss',
    [string]$ServerPath = '/game',
    [string]$TrainerName = 'Trainer'
)

# Compatibility entrypoint. The old standalone socket-demo client was
# superseded by the gpSP runtime and cannot speak production WSS.
& (Join-Path $PSScriptRoot 'build-runtime.ps1') -RomPath $RomPath -ServerHost $ServerHost -ServerPort $ServerPort -Transport $Transport -ServerPath $ServerPath -TrainerName $TrainerName
exit $LASTEXITCODE

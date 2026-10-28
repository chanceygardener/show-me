# Install the show-me CLI and its agent skill (Windows).
#
#   irm https://github.com/chanceygardener/show-me/releases/latest/download/install.ps1 | iex
#   .\install.ps1 [-Version vX.Y.Z] [-ForPlugin DIR] [-NoSkill] [-BinDir DIR] [-AgentHome DIR]
#
# The binary goes to <base>\bin\show-me.exe, where <base> is $env:SHOW_ME_HOME
# or %LOCALAPPDATA%\show-me, and is copied into -BinDir (default
# ~\.local\bin). Unblock-File clears any Mark-of-the-Web so SmartScreen
# doesn't prompt. The skill is copied, not linked: Windows symlinks need
# Developer Mode or admin rights. Re-running upgrades in place.
param(
  [string]$Version = 'latest',
  [string]$ForPlugin = '',
  [switch]$NoSkill,
  [string]$AgentHome = $HOME,
  [string]$BinDir = ''
)
$ErrorActionPreference = 'Stop'
if (-not $BinDir) { $BinDir = Join-Path $AgentHome '.local\bin' }

$Releases = if ($env:SHOW_ME_RELEASE_URL) { $env:SHOW_ME_RELEASE_URL } else { 'https://github.com/chanceygardener/show-me/releases' }
$Base = if ($env:SHOW_ME_HOME) { $env:SHOW_ME_HOME } else { Join-Path $env:LOCALAPPDATA 'show-me' }

function Say($Message) { Write-Host "show-me: $Message" }

$Arch = switch ($env:PROCESSOR_ARCHITECTURE) {
  'AMD64' { 'amd64' }
  'ARM64' { 'arm64' }
  default { throw "show-me: unsupported CPU $($env:PROCESSOR_ARCHITECTURE)" }
}
$Asset = "show-me_windows_$Arch.zip"

if ($ForPlugin) {
  $ForPlugin = (Resolve-Path $ForPlugin).Path
  $Version = 'v' + (Get-Content (Join-Path $ForPlugin 'VERSION') -Raw).Trim()
}

function Get-AssetUrl($Name) {
  if ($Version -eq 'latest') { "$Releases/latest/download/$Name" } else { "$Releases/download/$Version/$Name" }
}

# file:// URLs (used by the installer tests) are copied rather than downloaded.
function Get-Asset($Url, $OutFile) {
  if ($Url -like 'file://*') { Copy-Item -LiteralPath ([Uri]$Url).LocalPath -Destination $OutFile }
  else { Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $OutFile }
}

$Tmp = Join-Path ([IO.Path]::GetTempPath()) ('show-me-' + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Tmp | Out-Null
try {
  $Release = Join-Path $Tmp 'release'
  $Downloaded = $true
  try { Get-Asset (Get-AssetUrl $Asset) (Join-Path $Tmp $Asset) } catch { $Downloaded = $false }

  if ($Downloaded) {
    Get-Asset (Get-AssetUrl 'checksums.txt') (Join-Path $Tmp 'checksums.txt')
    $Line = Get-Content (Join-Path $Tmp 'checksums.txt') | Where-Object { ($_ -split '\s+')[1] -eq $Asset } | Select-Object -First 1
    if (-not $Line) { throw "show-me: checksums.txt has no entry for $Asset" }
    $Expected = ($Line -split '\s+')[0]
    $Actual = (Get-FileHash -Algorithm SHA256 (Join-Path $Tmp $Asset)).Hash.ToLower()
    if ($Expected -ne $Actual) { throw "show-me: checksum mismatch for $Asset (expected $Expected, got $Actual); nothing was installed" }
    Expand-Archive -Path (Join-Path $Tmp $Asset) -DestinationPath $Release
    Say "downloaded $Version ($Asset)"
  } elseif ($ForPlugin -and (Get-Command go -ErrorAction SilentlyContinue)) {
    Say "no $Version release found; building from $ForPlugin"
    New-Item -ItemType Directory -Path $Release | Out-Null
    Push-Location $ForPlugin
    try {
      go build -ldflags "-X main.version=$($Version.TrimStart('v'))-dev" -o (Join-Path $Release 'show-me.exe') ./cmd/show-me
      if ($LASTEXITCODE) { throw 'show-me: go build failed' }
    } finally { Pop-Location }
  } else {
    throw "show-me: could not download $(Get-AssetUrl $Asset)"
  }

  $Bin = Join-Path $Base 'bin'
  New-Item -ItemType Directory -Force -Path $Bin | Out-Null
  $Exe = Join-Path $Bin 'show-me.exe'
  Copy-Item -Force (Join-Path $Release 'show-me.exe') $Exe
  Unblock-File $Exe
  Say "installed $Exe"

  New-Item -ItemType Directory -Force -Path $BinDir | Out-Null
  Copy-Item -Force $Exe (Join-Path $BinDir 'show-me.exe')
  if (($env:Path -split ';') -contains $BinDir) {
    Say "copied to $BinDir"
  } else {
    Say "copied to $BinDir; add it to your user PATH to run show-me from anywhere"
  }

  if (-not $NoSkill) {
    $SkillSrc = if ($ForPlugin) { Join-Path $ForPlugin 'skills\show-me' } else { Join-Path $Release 'skills\show-me' }
    foreach ($Agent in '.claude', '.codex', '.cursor') {
      $AgentDir = Join-Path $AgentHome $Agent
      if (-not (Test-Path $AgentDir)) { continue }
      $Target = Join-Path $AgentDir 'skills\show-me'
      if (Test-Path $Target) { Remove-Item -Recurse -Force $Target }
      New-Item -ItemType Directory -Force -Path (Split-Path $Target) | Out-Null
      Copy-Item -Recurse $SkillSrc $Target
      Say "copied the skill to $Target"
    }
  }
} finally {
  Remove-Item -Recurse -Force $Tmp -ErrorAction SilentlyContinue
}

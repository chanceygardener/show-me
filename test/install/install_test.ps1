# Exercise install.ps1 against a fake release on disk, served over file:// URLs.
$ErrorActionPreference = 'Stop'
$Root = Resolve-Path (Join-Path $PSScriptRoot '..\..')
$Work = Join-Path ([IO.Path]::GetTempPath()) ("show-me-test-" + [Guid]::NewGuid())
New-Item -ItemType Directory -Path $Work | Out-Null
$Fail = 0
function Check($Label, [scriptblock]$Condition) {
  if (& $Condition) { Write-Host "  ok   $Label" } else { Write-Host "  FAIL $Label"; $script:Fail = 1 }
}
try {
  $Arch = if ($env:PROCESSOR_ARCHITECTURE -eq 'ARM64') { 'arm64' } else { 'amd64' }
  $Asset = "show-me_windows_$Arch.zip"
  $Stage = Join-Path $Work 'stage'
  New-Item -ItemType Directory -Force -Path (Join-Path $Stage 'skills\show-me') | Out-Null
  Push-Location $Root
  try { go build -ldflags "-X main.version=9.9.9" -o (Join-Path $Stage 'show-me.exe') ./cmd/show-me } finally { Pop-Location }
  Copy-Item (Join-Path $Root 'skills\show-me\SKILL.md') (Join-Path $Stage 'skills\show-me')
  $Release = Join-Path $Work 'releases\latest\download'
  New-Item -ItemType Directory -Force -Path $Release | Out-Null
  Compress-Archive -Path (Join-Path $Stage '*') -DestinationPath (Join-Path $Release $Asset)
  $Hash = (Get-FileHash -Algorithm SHA256 (Join-Path $Release $Asset)).Hash.ToLower()
  Set-Content -Path (Join-Path $Release 'checksums.txt') -Value "$Hash  $Asset"

  $AgentHome = Join-Path $Work 'home'
  New-Item -ItemType Directory -Force -Path (Join-Path $AgentHome '.claude') | Out-Null
  $env:SHOW_ME_HOME = Join-Path $AgentHome 'state'
  $env:SHOW_ME_RELEASE_URL = ([Uri](Join-Path $Work 'releases')).AbsoluteUri
  $Install = { & (Join-Path $Root 'install.ps1') -AgentHome $AgentHome -BinDir (Join-Path $AgentHome 'bin') | Out-Null }

  & $Install
  $Exe = Join-Path $env:SHOW_ME_HOME 'bin\show-me.exe'
  Check 'binary installed and runs' { (& $Exe version) -eq 'show-me 9.9.9 (protocol 1)' }
  Check 'copied into -BinDir' { Test-Path (Join-Path $AgentHome 'bin\show-me.exe') }
  Check 'skill copied for an installed agent' { Test-Path (Join-Path $AgentHome '.claude\skills\show-me\SKILL.md') }
  Check 'nothing created for agents that are not installed' { -not (Test-Path (Join-Path $AgentHome '.codex')) }
  & $Install
  Check 're-running is safe' { Test-Path (Join-Path $AgentHome '.claude\skills\show-me\SKILL.md') }

  Add-Content -Path (Join-Path $Release $Asset) -Value 'tampered'
  $Before = (Get-FileHash $Exe).Hash
  $Failed = $false
  try { & $Install } catch { $Failed = $_.Exception.Message -like '*checksum mismatch*' }
  Check 'a checksum mismatch fails' { $Failed }
  Check 'a checksum mismatch leaves the binary alone' { (Get-FileHash $Exe).Hash -eq $Before }
} finally {
  Remove-Item -Recurse -Force $Work -ErrorAction SilentlyContinue
}
exit $Fail

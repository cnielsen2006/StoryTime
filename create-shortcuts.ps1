# Creates desktop shortcuts for StoryTime.
# Run once:  powershell -ExecutionPolicy Bypass -File create-shortcuts.ps1
# Remove them again with:  -Remove

param(
    [switch]$Remove
)

$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$desktop = [Environment]::GetFolderPath('Desktop')

$shortcuts = @(
    @{
        Name        = 'StoryTime'
        Target      = Join-Path $root 'start.bat'
        Icon        = "$env:SystemRoot\System32\shell32.dll,70"
        Description = 'Write books from collected ideas. Opens at http://localhost:5173'
    },
    @{
        Name        = 'StoryTime (LAN)'
        Target      = Join-Path $root 'start-lan.bat'
        Icon        = "$env:SystemRoot\System32\shell32.dll,17"
        Description = 'Start StoryTime so other devices on this network can reach it'
    }
)

$shell = New-Object -ComObject WScript.Shell

foreach ($entry in $shortcuts) {
    $path = Join-Path $desktop "$($entry.Name).lnk"

    if ($Remove) {
        if (Test-Path $path) {
            Remove-Item $path -Force
            Write-Host "Removed: $path"
        }
        continue
    }

    if (-not (Test-Path $entry.Target)) {
        Write-Warning "Skipping '$($entry.Name)': $($entry.Target) does not exist."
        continue
    }

    $link = $shell.CreateShortcut($path)
    $link.TargetPath = $entry.Target
    $link.WorkingDirectory = $root
    $link.IconLocation = $entry.Icon
    $link.Description = $entry.Description
    $link.Save()
    Write-Host "Created: $path"
}

if (-not $Remove) {
    Write-Host ''
    Write-Host 'Double-click "StoryTime" on your desktop to start writing.'
}

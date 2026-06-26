$watcher = New-Object System.IO.FileSystemWatcher
$watcher.Path = (Get-Location).Path
$watcher.IncludeSubdirectories = $true
$watcher.EnableRaisingEvents = $true

Write-Host "👀 Watching for changes..."

while ($true) {
    $changed = Wait-Event -SourceIdentifier * -Timeout 5
    if ($changed) {
        Remove-Event -SourceIdentifier * -ErrorAction SilentlyContinue
        Start-Sleep -Seconds 2
        $changes = git status --porcelain
        if ($changes) {
            git add .
            git commit -m "auto save $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
            Write-Host "✅ Saved at $(Get-Date)"
        }
    }
}
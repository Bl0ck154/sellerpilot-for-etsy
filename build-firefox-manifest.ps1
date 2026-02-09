# Firefox Manifest Generator
# Reads src/manifest.json and creates Firefox-compatible version

$manifestPath = "src\manifest.json"
$outputPath = "dist\firefox\manifest.json"

Write-Host "Generating Firefox manifest from $manifestPath..."

# Read and parse manifest
$manifest = Get-Content $manifestPath -Raw | ConvertFrom-Json

# Remove offscreen permission (Firefox doesn't support it)
$manifest.permissions = @($manifest.permissions | Where-Object { $_ -ne "offscreen" })

# Change background to scripts array (Firefox MV3 requirement)
$manifest.background = @{
    scripts = @("background/service_worker.js")
}

# Add Firefox-specific settings
$manifest | Add-Member -MemberType NoteProperty -Name "browser_specific_settings" -Value @{
    gecko = @{
        id = "etsy-ai-assistant@bl0ck154.dev"
        strict_min_version = "109.0"
    }
} -Force

# Write to output
$manifest | ConvertTo-Json -Depth 10 | Out-File $outputPath -Encoding UTF8

Write-Host "Firefox manifest generated successfully!"

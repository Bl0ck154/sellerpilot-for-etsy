param(
    [Parameter(Mandatory = $true)]
    [string]$PreviousStoreVersion,

    [Parameter(Mandatory = $true)]
    [string]$OutputPath,

    [string]$AdditionalNotes = ""
)

$ErrorActionPreference = "Stop"

function Get-RegistryValue {
    param(
        [Parameter(Mandatory = $true)]$RegistrySection,
        [Parameter(Mandatory = $true)][string]$Name
    )

    $property = $RegistrySection.PSObject.Properties[$Name]
    if (-not $property) { return $null }
    return [string]$property.Value
}

$currentManifest = Get-Content "src/manifest.json" -Raw | ConvertFrom-Json
$currentVersion = [version]$currentManifest.version
$previousVersion = [version]$PreviousStoreVersion

if ($previousVersion -ge $currentVersion) {
    throw "previous_store_version ($PreviousStoreVersion) must be older than current package version ($($currentManifest.version))."
}

# Find the exact manifest that represented the version currently published in Edge.
# The workflow checks out full history so this does not rely on tags being present.
$previousManifest = $null
$previousManifestSha = $null
$manifestCommits = @(git log --format=%H --all -- src/manifest.json)
foreach ($sha in $manifestCommits) {
    $raw = (& git show "${sha}:src/manifest.json" 2>$null | Out-String)
    if (-not $raw.Trim()) { continue }

    try {
        $candidate = $raw | ConvertFrom-Json
    } catch {
        continue
    }

    if ([string]$candidate.version -eq $PreviousStoreVersion) {
        $previousManifest = $candidate
        $previousManifestSha = $sha
        break
    }
}

if (-not $previousManifest) {
    throw "Could not find src/manifest.json for previous Edge store version $PreviousStoreVersion in git history. Refusing to publish incomplete certification notes."
}

$registry = Get-Content ".github/edge-permission-justifications.json" -Raw | ConvertFrom-Json
$categories = @("permissions", "host_permissions", "optional_host_permissions")
$addedPermissions = @()
$removedPermissions = @()

foreach ($category in $categories) {
    $currentItems = @($currentManifest.$category)
    $previousItems = @($previousManifest.$category)
    $registrySection = $registry.$category

    # Every permission currently shipped must have a maintained justification,
    # even when it is not new in this particular release.
    foreach ($item in $currentItems) {
        $justification = Get-RegistryValue -RegistrySection $registrySection -Name $item
        if ([string]::IsNullOrWhiteSpace($justification)) {
            throw "Missing Edge permission justification for '$category' -> '$item' in .github/edge-permission-justifications.json."
        }
    }

    foreach ($item in $currentItems) {
        if ($previousItems -notcontains $item) {
            $addedPermissions += [pscustomobject]@{
                Category = $category
                Name = $item
                Justification = (Get-RegistryValue -RegistrySection $registrySection -Name $item)
            }
        }
    }

    foreach ($item in $previousItems) {
        if ($currentItems -notcontains $item) {
            $removedPermissions += [pscustomobject]@{
                Category = $category
                Name = $item
            }
        }
    }
}

$changelog = Get-Content "CHANGELOG.md" -Raw
$sectionMatches = [regex]::Matches(
    $changelog,
    '(?ms)^##\s+(?<version>\d+\.\d+\.\d+)[^\r\n]*\r?\n(?<body>.*?)(?=^##\s+\d+\.\d+\.\d+|\z)'
)

$releaseSections = @()
foreach ($match in $sectionMatches) {
    $versionText = $match.Groups['version'].Value
    $versionValue = [version]$versionText
    if ($versionValue -gt $previousVersion -and $versionValue -le $currentVersion) {
        $bullets = @()
        $bulletMatches = [regex]::Matches($match.Groups['body'].Value, '(?m)^\s*-\s+(?<text>.+?)\s*$')
        foreach ($bulletMatch in $bulletMatches) {
            $bullets += $bulletMatch.Groups['text'].Value.Trim()
        }

        $releaseSections += [pscustomobject]@{
            Version = $versionValue
            VersionText = $versionText
            Bullets = $bullets
        }
    }
}

$releaseSections = @($releaseSections | Sort-Object Version)
if ($releaseSections.Count -eq 0) {
    throw "CHANGELOG.md contains no release notes between $PreviousStoreVersion and $($currentManifest.version)."
}

$lines = New-Object System.Collections.Generic.List[string]
$lines.Add("Etsy AI Assistant $($currentManifest.version) - cumulative Edge certification notes")
$lines.Add("Previous Edge store version: $PreviousStoreVersion")
$lines.Add("Submitted version: $($currentManifest.version)")
$lines.Add("")
$lines.Add("Changes included since the currently published store build:")

foreach ($section in $releaseSections) {
    $lines.Add("Version $($section.VersionText):")
    if ($section.Bullets.Count -eq 0) {
        $lines.Add("- Internal maintenance documented in the repository changelog.")
    } else {
        foreach ($bullet in $section.Bullets) {
            $lines.Add("- $bullet")
        }
    }
}

$lines.Add("")
$lines.Add("Permission changes since $PreviousStoreVersion:")
if ($addedPermissions.Count -eq 0) {
    $lines.Add("- No new manifest permissions or host permissions.")
} else {
    foreach ($permission in $addedPermissions) {
        $lines.Add("- Added [$($permission.Category)] $($permission.Name): $($permission.Justification)")
    }
}

if ($removedPermissions.Count -gt 0) {
    foreach ($permission in $removedPermissions) {
        $lines.Add("- Removed [$($permission.Category)] $($permission.Name).")
    }
}

$lines.Add("")
$lines.Add("Reviewer/privacy note:")
$lines.Add("- Permission justifications are maintained in .github/edge-permission-justifications.json and are validated against the shipping manifest before publication.")
$lines.Add("- Any AI-provider network request is triggered by extension functionality and uses only the provider/endpoint selected or configured for that workflow; unlimitedStorage only increases local extension storage quota and does not itself grant network access.")

if (-not [string]::IsNullOrWhiteSpace($AdditionalNotes)) {
    $lines.Add("")
    $lines.Add("Additional reviewer notes:")
    $lines.Add($AdditionalNotes.Trim())
}

$notes = $lines -join "`r`n"
$parent = Split-Path -Parent $OutputPath
if ($parent -and -not (Test-Path $parent)) {
    New-Item -ItemType Directory -Path $parent -Force | Out-Null
}
Set-Content -Path $OutputPath -Value $notes -Encoding UTF8

$hasPermissionAdditions = $addedPermissions.Count -gt 0
if ($env:GITHUB_OUTPUT) {
    "current_version=$($currentManifest.version)" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
    "previous_manifest_sha=$previousManifestSha" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
    "has_permission_additions=$($hasPermissionAdditions.ToString().ToLowerInvariant())" | Out-File -FilePath $env:GITHUB_OUTPUT -Append -Encoding utf8
}

Write-Host "Generated cumulative certification notes for $PreviousStoreVersion -> $($currentManifest.version)."
Write-Host "Previous manifest commit: $previousManifestSha"
Write-Host "New permissions/hosts: $($addedPermissions.Count)"
Write-Host "Certification notes: $OutputPath"

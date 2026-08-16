# Microsoft Edge Add-ons Release

The repository contains an optional GitHub Actions workflow for publishing the Chromium build to Microsoft Edge Add-ons:

```text
.github/workflows/edge-addons.yml
```

## What the workflow does

1. Checks out the requested revision.
2. Runs `build.bat`.
3. Packages `dist/chrome/`.
4. Uploads the package to the Edge Add-ons draft submission API.
5. Optionally submits the draft for publication.
6. Waits for upload/publish processing status.

Edge uses the Chromium package; there is no separate Edge source tree.

## Required repository secrets

The workflow expects these GitHub Actions secrets:

```text
EDGE_PRODUCT_ID
EDGE_CLIENT_ID
EDGE_API_KEY
```

Only the **secret names** belong in repository documentation. Never commit, paste, log, or publish their values.

## Manual run

A maintainer can run the workflow from GitHub Actions and choose whether to upload only or upload and publish.

With GitHub CLI, an authenticated maintainer can use:

```powershell
gh workflow run edge-addons.yml --ref main -f publish=false
```

For an intentional release:

```powershell
gh workflow run edge-addons.yml --ref main -f publish=true -f notes="Release notes"
```

## Tag behavior

The workflow is also configured for pushed tags matching `v*`. A matching tag is a publication action, so maintainers should not create/push release tags casually.

## Credential rotation

Microsoft controls the lifetime and rotation requirements of Edge Add-ons API credentials. Rotate credentials in Partner Center when required and update the corresponding GitHub Actions secret. Do not record current secret values or private credential metadata in this repository.

## Failure handling

- Review the workflow job output for API status and processing errors.
- Do not expose credentials while debugging.
- Avoid repeated publish attempts when Partner Center reports that another submission is already in progress.

This workflow does not bypass Microsoft review or store processing.

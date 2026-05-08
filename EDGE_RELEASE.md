# Edge Release Automation

This project has Microsoft Edge Add-ons release automation configured through GitHub Actions.

Workflow:

```text
.github/workflows/edge-addons.yml
```

GitHub Actions URL:

```text
https://github.com/Bl0ck154/ChromeExtensionEtsyAI/actions/workflows/edge-addons.yml
```

The workflow uses the official Microsoft Edge Add-ons Update API v1.1.

Docs:

```text
https://learn.microsoft.com/en-us/microsoft-edge/extensions/update/api/using-addons-api?tabs=v1-1
```

## What It Does

- Builds the extension with `build.bat`.
- Packages the Chromium build from `dist/chrome`.
- Uploads the ZIP to Microsoft Edge Add-ons as a draft package.
- Optionally publishes the draft submission.
- Waits for Edge package/publish processing status.

Edge uses the same Chromium-compatible package as Chrome. There is no separate `dist/edge` build.

## Required GitHub Secrets

These are stored in GitHub repository secrets, not in the codebase:

```text
EDGE_PRODUCT_ID
EDGE_CLIENT_ID
EDGE_API_KEY
```

Secrets page:

```text
https://github.com/Bl0ck154/ChromeExtensionEtsyAI/settings/secrets/actions
```

## How To Publish

Manual release:

1. Open the workflow URL.
2. Click `Run workflow`.
3. Set `publish=false` to upload only as draft.
4. Set `publish=true` to upload and publish.
5. Optionally set certification notes.

CLI release, if GitHub CLI is authenticated:

```powershell
gh workflow run edge-addons.yml -f publish=true -f notes="Automated release from GitHub Actions."
```

Draft upload only:

```powershell
gh workflow run edge-addons.yml -f publish=false
```

Tag release:

```powershell
git tag v1.6.3
git push origin v1.6.3
```

Any pushed tag matching `v*` triggers upload and publish.

## API Key Expiry

Current `EDGE_API_KEY` expires:

```text
2026-07-19 22:55
```

Microsoft Edge Add-ons API keys do not auto-renew from this project. Before expiry, manually create/renew the API key in Partner Center and update the GitHub secret `EDGE_API_KEY`.

Partner Center:

```text
https://partner.microsoft.com/dashboard/microsoftedge/public/login
```

Path:

```text
Microsoft Edge -> Publish API -> API Keys
```

## Important Limits

This automation publishes through the Edge Add-ons pipeline. It does not bypass Microsoft review/processing, and it does not update extension code directly from GitHub.

Fast no-store updates for agent behavior are handled separately by `src/config/agent_policy.json` remote policy, which can update prompts/rules as data only.

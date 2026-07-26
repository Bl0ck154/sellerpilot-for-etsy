# Agent Instructions

## Edge Release Runbook

Use this when the user asks to release, publish, ship, or update the Microsoft Edge Add-ons version.

1. Update the extension version in `src/manifest.json` and the display version in `build.bat`.
2. Run `cmd /c build.bat` and confirm `dist/chrome/manifest.json` has the same version.
3. Commit and push the version/release changes before starting the release workflow.
4. Start the Edge workflow with publish enabled:

```powershell
gh workflow run "edge-addons.yml" --ref main -f publish=true -f notes="Release <version>: <short notes>."
```

5. Watch the run until it finishes:

```powershell
gh run watch <run_id> --exit-status
```

6. If Edge package processing fails with a generic transient error like `An error occurred while performing the operation` and `errorCode: null`, retry the workflow once.
7. If the workflow fails with `InProgressSubmission`, do not keep retrying immediately. Tell the user the previous Edge submission is still in progress and wait or check Partner Center.
8. After a successful workflow, update `tasks/todo.md` with the release result, commit, and push that tracking update.

Important:
- Edge uses `dist/chrome`; there is no separate `dist/edge` package.
- Never print, edit, or rotate `EDGE_PRODUCT_ID`, `EDGE_CLIENT_ID`, or `EDGE_API_KEY` from code. They live in GitHub Actions secrets.
- `EDGE_API_KEY` expires on `2026-10-06 16:10`; renewal instructions are in `EDGE_RELEASE.md`.
- Do not self-update extension code from GitHub. Code updates go through Store/API releases; remote behavior policy is data-only.

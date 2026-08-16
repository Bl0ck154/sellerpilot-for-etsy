# Contributing

Contributions are welcome.

## Development workflow

1. Fork the repository and create a focused branch.
2. Make source changes under `src/`.
3. Add or update tests when behavior changes.
4. Keep all fixtures synthetic.
5. Run relevant tests and browser/build checks.
6. Open a pull request describing the user-visible change and any privacy/permission impact.

## Source and build rules

- `src/manifest.json` is the manifest source of truth.
- `dist/` is generated output and must not be committed.
- Do not reintroduce hand-maintained browser-specific manifests.
- Update both `src/manifest.json` and `build.bat` when intentionally changing the release version.

## Privacy rules

Never include real production/customer material in commits, tests, examples, issues, or pull requests, including:

- Etsy customer names, messages, order details, addresses, attachments, or screenshots;
- seller cookies, sessions, browser profiles, or extension-storage exports;
- API keys, OAuth tokens, client secrets, refresh tokens, or store credentials;
- private diagnostic logs or HAR captures.

Use invented names, messages, IDs, URLs, and attachments in fixtures.

## AI/provider changes

If a change adds a provider, fallback, automatic analysis, or new data flow, document:

- what data is sent;
- when it is sent;
- where it is sent;
- what is stored locally;
- any new host or browser permission.

Update `PRIVACY_POLICY.md` and `ARCHITECTURE.md` when necessary.

## Pull requests

Keep PRs focused. Include:

- a short problem statement;
- the implementation summary;
- tests/checks performed;
- privacy/security implications, if any;
- screenshots only when they contain synthetic or fully redacted data.

Do not trigger browser-store release workflows as part of normal contribution testing.

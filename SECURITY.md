# Security Policy

## Supported code

Security fixes target the current `main` branch and the latest maintained release line.

## Reporting a vulnerability

Do **not** include API keys, Etsy customer data, browser cookies, order details, private screenshots, or working exploit secrets in a public GitHub issue.

Use GitHub's private **Report a vulnerability** / Private Vulnerability Reporting feature when it is available for this repository.

If private vulnerability reporting is unavailable, open a minimal public issue stating that you need a private channel for a security report. Do not include sensitive technical details in that issue.

## Credential exposure

If a credential may have been exposed:

1. Revoke or rotate it at the provider first.
2. Remove it from local browser settings and logs/exports.
3. Treat a credential committed to Git history as compromised even if the file is later deleted.

## Security model notes

- User-entered provider credentials are stored in browser extension local storage; the extension does not add its own encryption layer.
- Relevant Etsy/customer context can be sent to the configured AI provider when required by enabled AI features.
- Custom provider endpoints are user-controlled network destinations and should only be enabled when trusted.
- Generated customer replies should be reviewed by the seller before sending.

See [PRIVACY_POLICY.md](./PRIVACY_POLICY.md) and [ARCHITECTURE.md](./ARCHITECTURE.md) for more detail.

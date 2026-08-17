# Third-Party Notices

This repository includes third-party browser-side libraries under `src/libs/`. Those files remain subject to their original licenses; the project's MIT license does not replace them.

## Mozilla Readability

- Bundled file: `src/libs/Readability.min.js`
- Package/source: `@mozilla/readability`
- Bundled header identifies version `0.6.0`
- Upstream: `mozilla/readability`
- License: Apache License 2.0
- Copyright and attribution remain with the upstream project and contributors.

## Turndown

- Bundled file: `src/libs/turndown.js`
- Upstream: `mixmark-io/turndown`
- License: MIT
- Copyright and attribution remain with the upstream project and contributors.

## Notes for maintainers

When updating or replacing a vendored dependency:

1. Verify its upstream license before committing the new file.
2. Preserve required copyright/license notices in the vendored source.
3. Update this file if the dependency, version, source, or license changes.
4. Do not remove third-party attribution comments from minified or bundled code solely for cosmetic cleanup.

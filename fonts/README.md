# Fonts

Self-hosted copies of the two webfonts the game uses, so the page makes no
third-party requests at runtime.

| Family | Files | Upstream |
| --- | --- | --- |
| Outfit (variable, wght 100–900) | `outfit-latin.woff2`, `outfit-latin-ext.woff2` | https://fonts.google.com/specimen/Outfit |
| DM Mono (400, 500) | `dm-mono-400-*.woff2`, `dm-mono-500-*.woff2` | https://fonts.google.com/specimen/DM+Mono |

Both families are licensed under the SIL Open Font License 1.1
(https://openfontlicense.org). The `.woff2` payloads and the `@font-face`
`unicode-range` subsets in `fonts.css` are the ones served by the Google Fonts
`css2` endpoint.

To refresh, re-request the stylesheet with a modern browser user agent, download
the `fonts.gstatic.com` URLs it references, and update `fonts.css` to point at
the local filenames.

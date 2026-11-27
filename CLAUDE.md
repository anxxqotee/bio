# Notes for Claude

## Versioning
The site version lives in the footer: `PAGE_DATA.footer` in `index.html` (e.g. `"Артем Гай · 2026 · v3.0"`).
Bump it in **every** change that gets published (the owner asked for this explicitly):
- new feature / noticeable change → minor: v3.0 → v3.1
- bug fix / small tweak / performance → patch: v3.1 → v3.1.1
- huge overhaul → major: v3.x → v4.0
Mention the new version in the reply to the user.

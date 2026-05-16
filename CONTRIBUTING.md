# Contributing to Antigravity ARN-Lifebar

Thanks for thinking about contributing! ARN-Lifebar is intentionally small — a single-file extension that shows your AI quotas in the status bar. Small fixes, clearer code, missed edge-case tests, doc tweaks... all very welcome.

## Worth knowing before you start

- **Zero runtime dependencies.** The extension manifest stays dependency-free — pure Node.js + VS Code API. devDeps belong in `test/` only.
- **Status bar only.** No Webviews, no heavy UI surfaces — that's the whole point.

If your idea collides with one of these, open a discussion first — happy to chat about it.

## Project layout

```
.
├── extension.js          # The whole extension — single file, zero runtime deps
├── package.json          # Extension manifest (dependency-free)
├── media/                # Icon and screenshots
└── test/                 # Isolated test harness — devDeps live here only
    ├── package.json
    └── integration/      # Tests that run inside VS Code via @vscode/test-cli
```

## Workflow

1. Fork and branch from `main`.
2. Use [Conventional Commits](https://www.conventionalcommits.org/) for your commit messages (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `chore:`, …).
3. Add or update tests for any logic change.
4. Run the suite locally before opening a PR:
   ```bash
   cd test
   npm ci
   npm test
   ```
5. Open the PR against `main`. CI re-runs the same suite on Linux / macOS / Windows; it must be green before merge.

## Before publishing a new version

The CI suite proves the code parses and activates, but ARN-Lifebar only shows real quotas inside **Antigravity IDE**, signed in to a Google account. So before tagging a release, this manual check is required:

1. Build the `.vsix` locally: `npx vsce package`.
2. Install it in Antigravity IDE → `Extensions: Install from VSIX...`.
3. Confirm the status bar shows the live quotas — not `LS not found`.

## Reporting a security issue

See [SECURITY.md](SECURITY.md) for the private disclosure flow.

# Changelog

All notable changes to **Antigravity ARN-Lifebar** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.1] — 2026-05-25

### Changed
- Updated README.md documentation.

### Fixed
- Cached Open VSX badge data on the `badges` branch to avoid upstream rate limits.
- Cast Marketplace `downloadCount` to integer in CI workflows (fixes display formatting from "9.0" to "9").

### Chores & CI
- Bumped GitHub Actions to the latest versions.
- Bumped development dependencies (`mocha` to 11.7.6 and `@vscode/test-cli`).

## [1.0.0] — 2026-05-16

First public release on Visual Studio Marketplace and Open VSX.

- Native status bar item displaying live AI model quota usage.
- Per-model breakdown grouped as **Gemini Pro / Gemini Flash / Other**, with colored dot indicators based on remaining quota thresholds.
- Hover tooltip with plan name, prompt credits, flow credits, and per-model remaining percentage.
- Optional `GOOGLE_ONE_AI` credit balance suffix when the plan exposes it.
- Cross-platform discovery of the local Antigravity `language_server` process (Windows / macOS / Linux).
- Adaptive polling loop with exponential backoff (1 → 10 min) when the language server is unreachable.
- Commands: `ARN-Lifebar: Open Settings` and `ARN-Lifebar: Refresh quotas`.
- Dedicated **ARN-Lifebar** output channel for diagnostics.
- Zero runtime dependencies — pure native JavaScript, no build step.

[1.0.1]: https://github.com/jzbakh/antigravity-arn-lifebar/releases/tag/v1.0.1
[1.0.0]: https://github.com/jzbakh/antigravity-arn-lifebar/releases/tag/v1.0.0

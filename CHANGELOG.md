# Changelog

All notable changes to **Antigravity ARN-Lifebar** will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.3] — 2026-07-12

### Changed
- **Documentation:** Migrated all repository URLs to the new GitLab group `arn_inside`, consolidated the version badge, and refined badge color hierarchy.
- **UI:** Disabled the status bar click-to-open-settings action to prevent accidental triggers.
- **Performance:** Decreased the polling interval from 10s to 5s for faster quota updates.

## [1.2.2] — 2026-07-03

### Documentation
- Updated README badges for the extension stores (Marketplace and Open VSX) to point to the new GitLab infrastructure.

## [1.2.1] — 2026-06-27

### Changed
- **Quotas:** Added support for the new quota tracking limits introduced in Antigravity IDE Version 2.1.1.
- **Documentation:** Migrated all repository URLs and README badges across the codebase to point to the new GitLab infrastructure.

### Added
- **UI:** Status bar now explicitly tracks the 5-hour limit percentage. The hover tooltip has been completely upgraded to display the full quota breakdown, including both the 5-hour and weekly limits alongside their respective refresh timers.

## [1.1.1] — 2026-06-19

### Fixed
- **UI:** Adjusted quota color thresholds (🟢 / 🟠 / 🔴 / ⚫) to accurately support precise API percentage values instead of assuming rounded tens.
- **Documentation:** Fixed the status percentage range order in `README.md`.

## [1.1.0] — 2026-06-09

### Changed
- **Quotas:** Aligned with Antigravity IDE 2.0's new architecture by consolidating AI models into two unified tracking pools: **Gemini** (Google models) and **Third-party** (Claude, GPT-OSS).
- **UI:** Re-designed the status bar hover tooltip to group the model details clearly under their respective pools, and added a dynamic "Refreshes in..." timer to show when each quota resets.
- **Performance:** Reduced the quota polling interval from 60 seconds to 10 seconds for more real-time status bar updates.
- **Documentation:** Clarified the README and adjusted the UI logic to explicitly display a black dot (⚫) when the quota hits 0%.

### Fixed
- Fixed an omission where `GOOGLE_ONE_AI` credits were shown in the status bar but missing from the hover tooltip.

## [1.0.1] — 2026-05-25

### Changed
- Updated README.md documentation.

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

[1.2.3]: https://gitlab.com/arn_inside/antigravity-arn-lifebar/-/releases/v1.2.3
[1.2.2]: https://gitlab.com/arn_inside/antigravity-arn-lifebar/-/releases/v1.2.2
[1.2.1]: https://gitlab.com/arn_inside/antigravity-arn-lifebar/-/releases/v1.2.1
[1.1.1]: https://gitlab.com/arn_inside/antigravity-arn-lifebar/-/releases/v1.1.1
[1.1.0]: https://gitlab.com/arn_inside/antigravity-arn-lifebar/-/releases/v1.1.0
[1.0.1]: https://gitlab.com/arn_inside/antigravity-arn-lifebar/-/releases/v1.0.1
[1.0.0]: https://gitlab.com/arn_inside/antigravity-arn-lifebar/-/releases/v1.0.0

# Smart Steam Unlocker

Smart Steam Unlocker is a local Electron desktop application for viewing a Steam library, inspecting achievement data, performing explicit per-achievement actions, and tracking Steam-reported confirmation. It combines a React renderer with a restricted Electron preload bridge and local main-process services for Steamworks, Steam Web API reads, scheduling, persistence, and diagnostics.

> **Current development status:** version **0.3.0** is developed on [`feature/humanized-scheduler`](https://github.com/xKHl/Smart-Steam-Unlocker/tree/feature/humanized-scheduler). The default branch is `main`; active feature work must remain on the development branch and PR [#1](https://github.com/xKHl/Smart-Steam-Unlocker/pull/1) remains open.

## What is implemented

| Area | Current capability |
|---|---|
| Achievement actions | Instant queueing for explicitly selected achievements, with separate remote verification states rather than treating local activation as remote confirmation. |
| Humanized scheduling | **Humanized / محاكاة الإنسان** schedules with persisted timing, pause/resume, restart recovery, background verification, and manual safe recheck. |
| Ordering | Original Steam order, Natural / Story Progression, Most Common → Rarest, and Rarest → Most Common through one canonical main-process ordering pipeline. |
| Verification | Steam Web API verification for Instant and Humanized flows, including bounded continuation/recovery states. |
| Relock | Per-achievement **Relock / إعادة قفل الإنجاز** using the native clear-and-store path; it is not a global reset. |
| Library and Dashboard | Steam library browsing, selected-game context, achievement navigation, and a truthful dashboard summary. |
| Achievement Integrity | Read-only **Achievement Integrity / سلامة الإنجازات** analysis of Steam-reported data, evidence, timestamps, and limitations. |
| Trading Cards | Separate Steam launch-request monitor with explicit limitations; it does not fabricate running state, drops, or playtime. |
| Localization | English and Arabic application UI with persisted locale selection, explicit RTL shell ordering, and left-to-right treatment for technical identifiers. |

The application intentionally keeps Steam-provided game names, achievement names, descriptions, IDs, App IDs, Steam IDs, API keys, URLs, and code-like values unmodified. Arabic UI text is localized, while those technical and Steam-returned values remain readable in their original form.

## Important status boundaries

The repository has automated coverage and a production build for v0.3.0, but a **fresh Windows visual validation of the v0.3.0 Arabic/RTL remediation remains pending**. Do not represent Sidebar placement, full Arabic visual polish, or English-return visual parity as Windows-accepted until that manual check has been completed.

Historical Windows evidence exists for earlier development milestones, including real achievement unlock validation. It does not replace version-specific validation of new UI or packaging work. See [Project Status](docs/PROJECT_STATUS.md) for the full distinction between implemented, tested-only, historically Windows-validated, known limitations, and pending validation.

## Quick start

```bash
npm install
npm test
npm run dev
```

For a production build, run:

```bash
npm run build
```

The application expects Steam to be available for Steamworks-backed actions. Full owned-library and remote verification data require a Steam Web API key stored through the Settings screen. See [Build and packaging](docs/BUILD.md) and [Testing](docs/TESTING.md) before producing a Windows artifact or treating behavior as manually validated.

## Repository guide

| Document | Purpose |
|---|---|
| [Architecture](docs/ARCHITECTURE.md) | Main process, renderer, preload, IPC, Steam integrations, scheduling, persistence, truthfulness boundaries, i18n, and RTL architecture. |
| [Project Status](docs/PROJECT_STATUS.md) | Current version, stable features, validation evidence, design invariants, known limitations, and pending checks. |
| [AI Handover](docs/AI_HANDOVER.md) | A concise continuation guide for another AI coding agent or developer. |
| [Build](docs/BUILD.md) | Installation, test, build, Windows ZIP packaging, commit metadata, checksums, and release hygiene. |
| [Testing](docs/TESTING.md) | Automated suite map and repeatable Windows/Steam smoke-test checklists. |
| [Codebase Map](docs/CODEBASE_MAP.md) | Directory and file-level ownership map for the major subsystems. |
| [Contributing](CONTRIBUTING.md) | Branch discipline, validation standards, IPC/security constraints, localization rules, and documentation expectations. |
| [Historical Relock research](docs/v0.2.9-relock-research.md) | Historical rationale for per-achievement Relock. |
| [Historical readiness investigation](docs/first-achievement-root-cause.md) | Historical first-achievement readiness investigation; do not treat it as a current-state specification without checking current source and tests. |

## Links

The creator profile is [github.com/xKHl](https://github.com/xKHl). The project repository is [github.com/xKHl/Smart-Steam-Unlocker](https://github.com/xKHl/Smart-Steam-Unlocker). These are intentionally distinct links.

## Contribution boundary

This project has stateful Steam actions. Before changing execution, verification, ordering, scheduling, persistence, Relock, Trading Cards, Integrity, or RTL behavior, read [AI Handover](docs/AI_HANDOVER.md), [Architecture](docs/ARCHITECTURE.md), and the relevant existing tests. Do not change `main`, merge PR #1, or describe a local activation as confirmed by Steam without separately observed remote evidence.

## License and use

No license file is currently tracked in the repository. Review project ownership and any relevant Steam, Valve, and platform requirements before redistributing or changing the project’s operating model.

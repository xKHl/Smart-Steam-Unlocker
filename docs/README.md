# Smart Steam Unlocker Documentation Index

This directory contains the current documentation needed to continue Smart Steam Unlocker without access to previous task conversations. The current development version is **0.3.0** on [`feature/humanized-scheduler`](https://github.com/xKHl/Smart-Steam-Unlocker/tree/feature/humanized-scheduler). Feature work must remain off `main`; PR [#1](https://github.com/xKHl/Smart-Steam-Unlocker/pull/1) is intentionally open.

## Start here

| Read in this order | Purpose |
|---|---|
| [AI Handover](AI_HANDOVER.md) | The concise continuation guide: branch discipline, current architecture, invariants, historical milestones, known risks, and safe development workflow. |
| [Project Status](PROJECT_STATUS.md) | The authoritative current-state record, including implemented features, automated-tested state, historical Windows evidence, pending Windows validation, and known limitations. |
| [Codebase Map](CODEBASE_MAP.md) | The file/directory map for renderer, Electron, IPC, Steam, Humanized, verification, i18n/RTL, persistence, and tests. |
| [Architecture](ARCHITECTURE.md) | Source-grounded explanation of trust boundaries, main/renderer/preload/IPC, execution, scheduling, verification, Relock, Trading Cards, Integrity, localization, and RTL. |
| [Testing](TESTING.md) | Automated suite map and repeatable Windows/Steam/RTL manual validation checklists. |
| [Build](BUILD.md) | Installation, build, package metadata, SHA-stamped Windows ZIP, checksum, and cleanup process. |
| [Contributing](../CONTRIBUTING.md) | Required development discipline, security, truthfulness, scheduler, localization, testing, and documentation rules. |

## Current documentation boundaries

> **v0.3.0 Arabic RTL is implemented and automated-tested, but fresh Windows visual/runtime acceptance remains pending.** Do not change that status without new Windows evidence.

Historical research is retained for context, not as a current specification:

- [First-achievement root-cause investigation](first-achievement-root-cause.md)
- [SAM architecture comparison](sam-architecture-comparison.md)
- [v0.2.9 Relock research](v0.2.9-relock-research.md)

Check current source and tests before acting on a historical recommendation.

## Minimal continuation workflow

```bash
git branch --show-current
git status --short
git ls-remote origin refs/heads/feature/humanized-scheduler refs/heads/main
npm test
```

Then identify the affected subsystem in [Codebase Map](CODEBASE_MAP.md), trace the established UI → preload → IPC → service path, and make only an evidence-backed change. Run `npm test` and `npm run build` before a real commit. For Windows-facing changes, follow [Testing](TESTING.md) and [Build](BUILD.md) rather than claiming acceptance from a Linux build alone.

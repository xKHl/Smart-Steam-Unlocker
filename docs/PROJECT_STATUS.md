# Project Status

## Current repository state

| Field | Current value |
|---|---|
| Current version | **0.3.0** |
| Active development branch | [`feature/humanized-scheduler`](https://github.com/xKHl/Smart-Steam-Unlocker/tree/feature/humanized-scheduler) |
| Default branch | `main` |
| Current development commit at handover preparation start | `a9a85ed` — `feat: deliver v0.3.0 Arabic RTL localization` |
| Open pull request | [PR #1](https://github.com/xKHl/Smart-Steam-Unlocker/pull/1), from `feature/humanized-scheduler` to `main` |
| Repository | [xKHl/Smart-Steam-Unlocker](https://github.com/xKHl/Smart-Steam-Unlocker) |

This document is the **current-state record**. Historical documents in `docs/` are retained as evidence and research; they are not a replacement for this status record.

## IMPLEMENTED

The following capabilities are present in the current v0.3.0 source and are covered by the repository’s automated test suite where applicable.

| Area | Implemented behavior |
|---|---|
| Instant achievement queue | Explicit user-selected queue, local activation through the Steam manager, separate remote verification state, recheck control, persistence/recovery safeguards, and operation leases. |
| Humanized / محاكاة الإنسان | Persisted schedule creation, canonical ordering input, deterministic timing generation, execution/verification separation, live renderer countdown, pause/resume, manual safe recheck, queue state, and recovery-aware startup handling. |
| Ordering | Original Steam order, Natural / Story Progression, Most Common → Rarest, and Rarest → Most Common from the single canonical ordering pipeline. |
| Remote verification | Humanized and Instant flows observe Steam Web API state separately from local activation; a pending state is not represented as remote confirmation. |
| Relock / إعادة قفل الإنجاز | Validated, single-achievement clear-and-store operation with app context and lease protection, remote locked-state observation, and no global reset. |
| Achievement Integrity / سلامة الإنجازات | Read-only local analysis of Steam-returned achievement evidence, timestamps, playtime, descriptive signals, and limitations. |
| Trading Cards | Separate data classification and transparent Steam launch-request monitor; no unsupported game-running/drop/playtime claims. |
| Library and Dashboard | Steam Web API library flow, explicit current-session game selection, game-switch safeguard for genuinely running Humanized schedules, and truthful activity semantics. |
| Localization and RTL | Persisted English/Arabic locale, full shared/page localization surface, Arabic RTL shell classes, Sidebar-right desktop layout, technical LTR values, and exact required Arabic terminology. |
| Persistence and diagnostics | Atomic settings writes/recovery notice, secure credential boundary, persisted service state, bounded diagnostics hooks, and a process-wide operation coordinator. |

## TESTED ONLY

The latest v0.3.0 work was tested in the repository environment as follows:

| Check | Result |
|---|---:|
| `npm test` | **158 passed, 0 failed** during the v0.3.0 implementation pass. |
| `npm run build` | **Passed** for v0.3.0. The configured Linux production artifact was produced. |
| Windows ZIP packaging | A SHA-stamped v0.3.0 Windows ZIP was produced from Linux and its embedded metadata was checked for `version: 0.3.0` and `ssuBuildCommit: a9a85ed`. |
| RTL source contract | Automated coverage checks explicit RTL classes, main-content order `1`, Sidebar order `2`, right-side Sidebar border/indicator rules, required Arabic terms, major-page translation integration, and technical LTR selectors. |

These checks establish source/build integrity. They do not by themselves establish a successful live Steam action or a polished Windows visual result for the current package.

## WINDOWS VALIDATED

The repository retains historical evidence that an earlier stable achievement path was manually validated on Windows: the v0.2.8-era context records a report of **67 real achievement unlocks in one game**. That evidence supports the historical achievement execution baseline only.

Earlier Windows investigation and scheduling work also produced diagnostics, targeted tests, and issue-specific fixes. Treat historical manual results as version- and scenario-specific; re-check current source and tests before using them as the basis for a new change.

## PENDING VALIDATION

The following v0.3.0 checks require fresh Windows manual validation and must not be reported as completed until evidence is collected.

| Pending check | Required evidence |
|---|---|
| Arabic RTL shell | Arabic selected in Settings; Sidebar visibly on the right, main content left/center, right-side active marker/border, usable window controls, and responsive behavior at standard and constrained window heights. |
| Complete Arabic visual review | Dashboard, Library, Achievements, محاكاة الإنسان, Trading Cards, سلامة الإنجازات, and Settings show professional Arabic surrounding UI with no unintended English chrome. |
| Data directionality | Game names, Steam-provided achievement names/descriptions, App IDs, Steam IDs, achievement IDs, URLs, API-key input, and code-like values remain unmodified and LTR. |
| English return path | Switching immediately back to English restores the established LTR layout and English labels without Arabic/RTL visual leakage. |
| Relock on Windows | A safe, per-achievement Relock validation with the expected remote locked-state observation, performed only in an appropriate test context. |
| Steam lifecycle smoke test | Select a library game, load achievements, run an allowed Instant or Humanized test action only in a controlled test account/context, and observe the correct remote verification state. |
| Trading Cards visual/truthfulness review | Launch-request, monitoring, pause/stop, no-data, and exhausted states remain accurate on Windows. |

## KNOWN LIMITATIONS

| Limitation | Meaning |
|---|---|
| No v0.3.0 Windows acceptance yet | The Windows ZIP was cross-packaged from Linux, but current Arabic/RTL visual and interaction acceptance is pending. |
| Steam state depends on external services | Steam client availability, account privacy, API-key validity, Web API propagation, and game support affect live behavior. A local activation acceptance is not automatic remote verification. |
| Trading Cards monitor is not process idling | A Steam launch request and data refresh do not prove game-running state or guarantee any card drop. Stop/Pause does not claim to close a Steam game. |
| Integrity is descriptive only | Integrity signals depend on returned evidence and are not a verdict of intent or legitimacy. |
| Existing historical reports may be stale | `first-achievement-root-cause.md` and `sam-architecture-comparison.md` are retained historical investigations. Their recommendations and version framing require comparison with current code and tests before acting on them. |
| No license file is tracked | Repository distribution/licensing terms are not defined by a tracked `LICENSE` file. |

## Design invariants

1. **Keep `main` untouched during feature development.** Continue work on `feature/humanized-scheduler` and keep PR #1 open unless an authorized maintainer decides otherwise.
2. **A Humanized schedule owns one immutable App ID.** Do not retarget a persisted schedule to another game.
3. **Execution is not verification.** Local activation/clear acceptance and Steam Web API confirmation are separate states.
4. **Verification must not re-activate an achievement.** Recheck and recovery paths observe state; they do not issue speculative duplicate writes.
5. **Use one canonical ordering pipeline.** Do not create renderer-only sorting behavior that diverges from schedule creation.
6. **Preserve truthful Steam claims.** Do not fabricate game running, drops, playtime, remote confirmation, or library/achievement information.
7. **Relock is per achievement.** Never substitute a global reset for a single achievement request.
8. **Keep ownership coordinated.** Instant, Humanized, and Relock operations must respect operation leases.
9. **Arabic is a first-class RTL UI.** Keep main content left/center and Sidebar right in Arabic desktop layout; do not translate Steam/game identifiers or technical values.
10. **Do not broaden the preload bridge casually.** Validate IPC inputs and preserve credential/external-link boundaries.

## Historical documentation

The following documents are intentionally retained as historical records:

- [First-achievement root-cause investigation](first-achievement-root-cause.md)
- [SAM architecture comparison](sam-architecture-comparison.md)
- [v0.2.9 Relock research](v0.2.9-relock-research.md)

They are valuable context, but `PROJECT_STATUS.md`, [Architecture](ARCHITECTURE.md), [AI Handover](AI_HANDOVER.md), and tests are the primary starting points for current maintenance.

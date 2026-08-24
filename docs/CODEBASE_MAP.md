# Codebase Map

This map identifies the current ownership of the important Smart Steam Unlocker subsystems. Use it to begin focused investigation rather than searching the whole repository or creating parallel implementations.

## Top-level layout

| Path | Purpose |
|---|---|
| `electron/` | Electron main-process services, Steam integrations, IPC, persistence, scheduling, diagnostics, and Trading Cards domain logic. |
| `src/` | React renderer, routes, shared components, localization, CSS, and renderer-only presentation helpers. |
| `tests/` | Node test-runner suites covering domain logic and source-level regression contracts. |
| `docs/` | Current handover/build/testing/architecture documents plus preserved historical research. |
| `scripts/` | Repository utility scripts, if any are added/maintained. |
| `.github/workflows/secret-scan.yml` | GitHub Actions secret scan workflow. |
| `package.json` | Application version, scripts, dependencies, and electron-builder configuration. |
| `package-lock.json` | Locked dependency graph and root package metadata. |
| `steam_appid.txt` | Steam App ID resource included in packaged application configuration. |
| `release/` | Generated build artifacts; treat as output, not product source. |
| `dist/` | Generated renderer build output. |

## Renderer: routes and shared shell

| Concern | Primary files | Notes |
|---|---|---|
| Renderer entrypoint | `src/main.jsx` | React root and provider composition. |
| Application routes / selected game | `src/App.jsx` | Routes, per-session selected-game state, status polling, game switch path, RTL classes. |
| Global styling / RTL shell | `src/index.css` | Base shell, Sidebar, responsive layout, explicit Arabic Sidebar-right rules, technical LTR selectors. |
| Localization provider | `src/i18n/index.jsx` | Locale persistence bridge, document `lang`/`dir`, translation helper/context. |
| Translation catalog | `src/i18n/translations.mjs` | English/Arabic keys. Keep new UI copy here rather than hardcoding strings. |
| Header/titlebar | `src/components/Header.jsx` | Frameless-window titlebar and window controls. |
| Sidebar | `src/components/Sidebar.jsx` | Navigation, selected game display, creator profile link, project chrome. |
| Status bar | `src/components/StatusBar.jsx` | Connection/version/status presentation. |

## Renderer: pages and components

| Area | Primary files | Notes |
|---|---|---|
| Dashboard | `src/pages/Dashboard.jsx` | Overview, connection UX, game selection routes, activity semantics, library snapshot. |
| Library | `src/pages/Library.jsx` | Library fetch/presentation, filter/sort/search, game-card selection/error UI. |
| Game card | `src/components/GameCard.jsx` | Native click button used by Library selection flow. |
| Achievements | `src/pages/Achievements.jsx` | Instant/Humanized mode host, achievement fetch, selection, Relock dialog, filter/search. |
| Achievement card | `src/components/AchievementCard.jsx` | Steam-provided achievement presentation and Relock affordance for unlocked items. |
| Humanized panel | `src/components/HumanizedSchedulePanel.jsx` | Ordering choice, timing setup, schedule state, countdown, pause/start/recheck/clear UI. |
| Trading Cards | `src/pages/TradingCards.jsx` | Separate monitor UI and truthful card-state presentation. |
| Achievement Integrity | `src/pages/AchievementIntegrity.jsx` | Read-only library choice, scan, analysis/evidence/timeline UI. |
| Settings | `src/pages/Settings.jsx` | API-key status/save/clear, language choice, trusted creator/project links. |

## Renderer domain helpers

| Concern | Files | Notes |
|---|---|---|
| Canonical execution payload | `src/lib/executionAchievementPayload.mjs` | Projects renderer achievements to fields allowed by execution IPC. |
| Grid/selection helpers | `src/lib/achievementDisplayProjection.mjs`, `src/lib/achievementBulkSelection.mjs` | Preserve ordered display and bulk-selection behavior. |
| Integrity analysis | `src/lib/achievementIntegrity.mjs` | Read-only descriptive evidence analysis and date/duration helpers. |
| Humanized presentation | `src/lib/humanizedCountdownRefresh.mjs`, `src/lib/humanizedTimingPresets.mjs`, `src/lib/humanizedVerificationPresentation.mjs` | Renderer-only countdown/timing/verification presentation. |
| Trading Card projection | `src/lib/tradingCardProjection.mjs` | Deterministic renderer projection/filtering/sorting. |

## Electron startup, bridge, and IPC

| Concern | Files | Notes |
|---|---|---|
| Electron bootstrap | `electron/main.js` | Single-instance behavior, BrowserWindow configuration, CSP, service initialization, app shutdown. |
| Renderer bridge | `electron/preload.js` | Restricted `window.steamAPI`; do not expose Node/Electron broadly. |
| IPC registry | `electron/ipc/handlers.js` | Channel dispatch, cache policy, game-switch protection, locale persistence, trusted URLs. |
| IPC validation | `electron/ipc/validation.js` | App ID, payload, ordering, timer, unlock, Relock, and switch-game sanitization. |
| Runtime diagnostics | `electron/runtimeDiagnostics.js` | Diagnostic status/tracing system. |

## Steam, execution, verification, and coordination

| Concern | Files | Notes |
|---|---|---|
| Steam client / actions | `electron/steamManager.js` | Steamworks lifecycle, app context, unlock, Relock, local/remote achievement interactions, events. |
| Steam Web API client | `electron/steamApiClient.js` | Typed remote library/badge/achievement request contract and normalized errors. |
| Instant timer service | `electron/timerService.js` | Existing Instant queue, pending verification, persistence/recovery, queue leases. |
| Instant verification policy | `electron/instantVerificationPolicy.js` | Instant pending verification state/poll policy. |
| Operation coordinator | `electron/operationCoordinator.js` | Cross-mode per-achievement lease conflict protection. |
| Real Humanized adapters | `electron/humanized/realSteamAdapters.js` | Connects core scheduler operations to `steamManager`. |

## Humanized scheduler subsystem

| Concern | Files | Notes |
|---|---|---|
| Service integration | `electron/humanizedService.js` | Service lifecycle, persistence, tick loop, lease synchronization, renderer update events. |
| Scheduler engine | `electron/humanized/schedulerEngine.js` | State machine, deterministic schedule creation, due processing, verification barrier, pause/restart recovery. |
| Canonical ordering | `electron/humanized/ordering.js` | Sole ordering implementation for display IPC and schedule input. |
| Timeline | `electron/humanized/timeline.js` | Deterministic scheduled timestamps/timing support. |
| Schedule validation | `electron/humanized/scheduleValidation.js` | Incoming/persisted schedule validation. |
| Replacement policy | `electron/humanized/schedulePolicy.js` | Rules for creating/replacing schedules. |
| Verification polling | `electron/humanized/verificationPolling.js` | Humanized remote verification policy. |
| Mock adapters | `electron/humanized/mockExecutionAdapter.js`, `electron/humanized/mockVerifier.js` | Tests/development support; do not confuse with real runtime integration. |

## Trading Cards subsystem

| Concern | Files | Notes |
|---|---|---|
| Main service | `electron/tradingCardsService.js` | Library aggregation, monitor lifecycle, persistence, truthful state transitions. |
| Classification | `electron/tradingCards/cardClassification.js` | Explicit card/drop data classification. |
| Monitor state | `electron/tradingCards/monitorState.js` | Monitor validation and state lifecycle. |
| Store metadata | `electron/tradingCards/storeMetadataClient.js` | Steam Store category evidence. |

## Persistence and credentials

| Concern | Files | Notes |
|---|---|---|
| General settings | `electron/settingsStore.js` | Atomic JSON persistence and corrupt-state recovery notice. |
| Steam Web API credential | `electron/credentialStore.js` | Secure credential storage/status boundary. |
| Persisted keys used by services | `humanizedSchedulerState`, `timerState`, `tradingCardMonitorState`, locale/selected-game preferences | Inspect the owning service before changing shape or recovery semantics. |

## Tests

The tests use the Node test runner and are in `tests/`. The filename is the best entrypoint for a focused change:

| Change area | First tests to read |
|---|---|
| Humanized core | `humanizedScheduler.test.js`, `humanizedTimingWorkflow.test.js`, `stateIntegrity.test.js` |
| Ordering | `humanizedOrderingIpcBoundary.test.js`, `humanizedDisplayOrdering.test.js`, `naturalStoryOrdering.test.js` |
| Instant/verification | `executionPayloadAndInstant.test.js`, `instantVerificationPolicy.test.js`, `verificationPolling.test.js` |
| Readiness | `achievementReadinessAndActivity.test.js`, `realSteamAdapters.test.js` |
| Relock/localization/RTL | `relockAndLocalization.test.js` |
| Library/game selection | `selectedGameSemantics.test.js`, `appInitialStateNavigation.test.js` |
| Integrity | `achievementIntegrity.test.js` |
| Trading Cards | `tradingCards.test.js` |
| IPC/persistence/credentials | `ipcValidation.test.js`, `stateIntegrity.test.js`, `settingsHooksImport.test.js` |
| Diagnostics | `runtimeDiagnostics.test.js` |

For all test/build/manual validation procedures, use [TESTING.md](TESTING.md) and [BUILD.md](BUILD.md).

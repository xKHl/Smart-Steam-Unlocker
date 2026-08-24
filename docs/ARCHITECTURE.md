# Architecture

## Scope and trust model

Smart Steam Unlocker is an Electron application with a React renderer. The architecture deliberately separates presentation code from Steam actions, persistence, credential handling, and operating-system integration.

> **Core boundary:** renderer code receives a narrow `window.steamAPI` bridge. It does not receive Node.js globals, direct filesystem access, plaintext stored credentials, or unconstrained shell access.

`electron/main.js` creates a single frameless window with `contextIsolation: true`, `nodeIntegration: false`, and `sandbox: true`. In packaged mode it installs a restrictive Content Security Policy. Main-process startup registers IPC handlers, initializes the Instant timer, Humanized service, and Trading Cards service, then opens the renderer window.

| Layer | Primary responsibility | Key files |
|---|---|---|
| Electron main process | Window lifecycle, service startup, CSP, trusted process boundaries | `electron/main.js` |
| Preload bridge | Restricted renderer API over named IPC channels | `electron/preload.js` |
| IPC registry | Input sanitization, policy checks, dispatch to services | `electron/ipc/handlers.js`, `electron/ipc/validation.js` |
| Renderer | Routes, user interaction, visual state, localization, RTL presentation | `src/App.jsx`, `src/pages/*`, `src/components/*` |
| Steam domain services | Steamworks lifecycle, remote data reads, instant execution, Humanized execution, Trading Cards | `electron/steamManager.js`, `electron/timerService.js`, `electron/humanizedService.js`, `electron/tradingCardsService.js` |
| Local persistence | Atomic settings state and secure API-key storage | `electron/settingsStore.js`, `electron/credentialStore.js` |

## Renderer and application shell

`src/main.jsx` mounts the React application. `src/App.jsx` owns the client-side routes, per-session selected-game state, connection status polling, and the transition to the Achievements route after `steam:switch-game` succeeds.

The principal routes are Dashboard, Library, Achievements, Trading Cards, Achievement Integrity, and Settings. `Sidebar.jsx`, `Header.jsx`, and `StatusBar.jsx` provide shared chrome. Pages access main-process functionality only through the preload bridge.

Selected-game behavior is intentionally session-based in the renderer. The main process can persist selected-game metadata for safety and service context, but `app:get-initial-state` returns `selectedGame: null`; a game must be explicitly chosen in the current renderer session.

## Preload and IPC boundary

`electron/preload.js` exposes only grouped APIs for window controls, Steam data/actions, Humanized controls, Trading Cards, Instant timer controls, credential status/mutation, localization preferences, diagnostics, and whitelisted external links.

`electron/ipc/handlers.js` is the central registration layer. Its responsibilities are intentionally limited to handler wiring, validation, cache policy, access policy, and delegating domain behavior to services. `electron/ipc/validation.js` sanitizes App IDs, achievement IDs, scheduler payloads, timer payloads, owned-game options, game switching data, ordering inputs, and Relock payloads.

| Boundary rule | Current implementation |
|---|---|
| Untrusted renderer input | Validated or sanitized before a Steam/service call. |
| API key secrecy | The renderer may submit a replacement key and request non-sensitive status, but cannot retrieve a stored plaintext key. |
| External URLs | `app:open-external` accepts only the trusted creator profile, repository, and website URLs listed in `TRUSTED_EXTERNAL_URLS`. |
| Game-switch safety | A switch to a different App ID is blocked only while a Humanized schedule is actually `running`; paused, failed, completed, or recovered stale schedules do not block ordinary Library selection. |
| Relock safety | Relock is blocked while a Humanized schedule is running. |

## Steam integration and data sources

`electron/steamManager.js` owns the Steamworks.js client lifecycle, app context switching, local achievement actions, status reporting, achievement reads, remote verification support, and the event notifications consumed by the renderer.

The application uses two distinct Steam-facing classes of evidence:

1. **Steamworks / local client actions** perform a local activation or clear operation in the current Steam game context.
2. **Steam Web API reads** retrieve owned-library data and remote achievement state for verification and read-only analysis.

These are not interchangeable. A successful local operation must not be displayed as confirmed remote Steam state until the verification path observes the expected remote state.

`electron/steamApiClient.js` provides the typed Web API client. `electron/credentialStore.js` supplies the securely stored API key where available. The `steam:get-owned-games` handler caches successful library data for five minutes; Settings mutations invalidate that cache.

## Achievement execution and verification

### Instant path

The existing Instant queue is implemented by `electron/timerService.js`. It accepts selected achievement payloads, owns leases for queued items, calls `steamManager.unlockAchievement`, then moves to pending verification rather than treating activation acceptance as completion.

A pending item is evaluated by `steamManager.getAchievementVerification`. The timer state persists `pendingVerification`, retry timing, and queue context. Restart restoration is intentionally conservative: it restores read-only or verification continuation context rather than issuing a duplicate external write. The renderer presents pending, verified, and needs-attention outcomes distinctly.

### Humanized path

The Humanized system is split into a service boundary and a Steam-independent scheduler core.

| Component | Responsibility |
|---|---|
| `electron/humanizedService.js` | Creates the scheduler, connects real Steam execution/verification adapters, persists schedule state, synchronizes leases, emits renderer updates, and owns the one-second due-time loop. |
| `electron/humanized/schedulerEngine.js` | Creates schedules, advances due work, distinguishes execution from verification, applies bounded verification policy, handles pause/restart recovery, and produces status summaries. |
| `electron/humanized/realSteamAdapters.js` | Adapts scheduler operations to `steamManager` without placing Steam calls in the scheduler core. |
| `electron/humanized/timeline.js` | Produces deterministic timing data from supplied schedule options. |
| `electron/humanized/scheduleValidation.js` | Validates persisted and incoming schedule shape/state. |
| `electron/humanized/schedulePolicy.js` | Enforces schedule replacement policy. |
| `src/components/HumanizedSchedulePanel.jsx` | Renders setup, timing presets, live countdown, state, verification, pause/start/recheck/clear controls, and persisted schedule evidence. |

A Humanized schedule owns one App ID. It does not retarget itself to a different game. The service persists it under `humanizedSchedulerState`, validates it on startup, and uses scheduler recovery logic. Recovery prevents stale interrupted execution from silently becoming a new activation: non-verification `running` state is recovered to a paused state, while a verification-required item can continue through its verifier-first policy.

The service has a local tick loop only while the schedule is `running`. It stops the loop on pause, clear, terminal/no-running state, or tick failure. `recheckNow` is guarded against concurrent work and performs a verification operation rather than an activation retry.

## Canonical ordering pipeline

Ordering is centralized in `electron/humanized/ordering.js`. The IPC endpoint `humanized:order-achievements` validates renderer input, requests ordering metadata, and applies the same canonical ordering function used for scheduling. The renderer projects the resulting ordered list for the grid.

The supported modes are Original Steam order, Natural / Story Progression, Most Common → Rarest, and Rarest → Most Common. Search and filters operate as presentation layers over the canonical order; they must not create an independent ordering algorithm. The selected grid order, bulk-selection order, and newly created Humanized schedule order must agree for the same canonical input.

## Operation coordination and leases

`electron/operationCoordinator.js` is a process-wide coordinator for achievement operations. Leases are keyed by `appId:achievementId` and include an owner and mode. It prevents another active execution path from claiming the same achievement while already leased.

Instant and Humanized services synchronize leases as queues and schedules change. Humanized uses an owner derived from schedule identity. Relock claims/releases its own per-achievement operation lease. Restart resets process-memory leases, after which restored services rebuild valid ownership from persisted state.

## Persistence and recovery

`electron/settingsStore.js` writes `app-settings.json` beneath Electron’s user-data directory. It writes through a temporary file, flushes it, closes it, and renames it over the destination. If a settings file is corrupt, it is quarantined with a timestamped filename and a recovery notice is made available to services.

Persisted state includes application preferences such as locale, selected-game metadata, Instant timer state, Humanized schedule state, and Trading Cards monitor state. Secrets are kept separately by `credentialStore.js`; the renderer never reads them back after save.

## Relock

Relock is a narrow per-achievement operation in `steamManager`. It validates App ID and achievement ID at IPC, checks the local state, calls the Steamworks achievement clear method for that achievement, performs one stats store, and observes the remote locked state separately. It emits `steam:achievement-relocked` only through its defined lifecycle.

> **Relock invariant:** never use a global reset to implement a single-achievement Relock action.

See the preserved [v0.2.9 Relock research](v0.2.9-relock-research.md) for the historical design rationale.

## Trading Cards

Trading Cards are intentionally separate from achievement execution and Humanized scheduling. `electron/tradingCardsService.js` reads library, Steam Store metadata, and Steam badge evidence to classify eligibility and remaining drops. It stores its monitor state separately under `tradingCardMonitorState`.

Starting a monitor sends a validated `steam://run/<appId>` launch request through the main-process handler only when its evidence policy permits it. The monitor does **not** claim the game is running, does not fabricate remaining drops, and does not close a game on stop. After restart, a monitor restores as non-running/paused state rather than assuming a Steam game is still active.

## Achievement Integrity

Achievement Integrity is a read-only local evidence workflow. `src/pages/AchievementIntegrity.jsx` requests the dedicated `steam:get-achievement-integrity-data` IPC endpoint, which tells `steamManager` not to merge optimistic cache into remote evidence. `src/lib/achievementIntegrity.mjs` evaluates available timing, progression, and playtime signals and renders evidence with stated limitations.

The feature does not unlock, modify, submit, or publish achievements. Its results are descriptive signals, not a determination of intent or legitimacy.

## Localization and RTL

`src/i18n/index.jsx` provides a small application-specific context. It reads/writes `en` or `ar` through locale IPC, applies `lang` and `dir` to the document, and exposes `t`, `locale`, and `direction`. `src/i18n/translations.mjs` is the shared English/Arabic catalog.

RTL is not only inherited from document direction. `src/App.jsx` applies explicit RTL classes, and `src/index.css` gives the Arabic shell explicit desktop ordering: main content is visually left/center and Sidebar is visually right. The CSS also moves the Sidebar border and active indicator to the right and preserves left-to-right rendering for technical values such as URLs, App IDs, Steam IDs, API keys, code, and achievement IDs.

The Arabic product term for Humanized Mode is **محاكاة الإنسان**. Relock is **إعادة قفل الإنجاز**; Unlock is **فتح الإنجاز**. Achievement Integrity is **سلامة الإنجازات**.

## Diagnostics

`electron/runtimeDiagnostics.js` supplies bounded runtime tracing when diagnostics are enabled. The main process records window/process lifecycle, IPC handler timing, and explicitly submitted renderer interaction metadata. Diagnostics are a troubleshooting mechanism; they are not a substitute for a verified Steam action or manual Windows UI validation.

## Security and maintenance implications

Any future change that expands preload, IPC, credentials, external URLs, execution behavior, verification policy, ordering, or persistence has to preserve the boundaries described above. Use the existing tests as part of the design contract, not merely as a post-change check.

For concrete files and tests, see [Codebase Map](CODEBASE_MAP.md). For continuation constraints and release/validation requirements, see [AI Handover](AI_HANDOVER.md) and [Project Status](PROJECT_STATUS.md).

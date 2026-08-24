# Testing Guide

## Testing principle

Smart Steam Unlocker has two different validation layers:

1. **Automated tests** establish source-level contracts, deterministic domain behavior, validation boundaries, and regression protection.
2. **Manual Windows/Steam tests** establish runtime UI behavior and externally observed Steam outcomes that cannot be proven by a Linux build or static test alone.

Do not use one layer to overclaim the other. A passing automated suite does not prove a Steam action completed remotely, and a single manual observation does not replace regression coverage.

## Automated tests

Run the complete suite from repository root:

```bash
npm test
```

The current script executes:

```text
node --test tests/*.test.js
```

### Important test areas

| Test area | Representative files | What it protects |
|---|---|---|
| Humanized scheduler core | `humanizedScheduler.test.js`, `humanizedTimingWorkflow.test.js`, `humanizedCountdownRefresh.test.js` | Timing, state transitions, validation, scheduling, recovery-oriented presentation countdowns. |
| Canonical ordering | `humanizedDisplayOrdering.test.js`, `humanizedOrderingIpcBoundary.test.js`, `naturalStoryOrdering.test.js`, `mafiaIIOrderingFallback.test.js` | Main-process ordering modes, stable projection, and display/schedule parity. |
| Instant execution and verification | `executionPayloadAndInstant.test.js`, `instantVerificationPolicy.test.js`, `verificationPolling.test.js` | Canonical payloads, pending verification, polling transitions, and completion policy. |
| Steam readiness/activity | `achievementReadinessAndActivity.test.js`, `realSteamAdapters.test.js` | Readiness architecture contracts and truthful Dashboard activity semantics. |
| Relock and localization | `relockAndLocalization.test.js` | Per-achievement Relock constraints, preload/IPC boundary, locale persistence, required Arabic terms, RTL shell selectors, and technical LTR protection. |
| Library/selection/UI regressions | `selectedGameSemantics.test.js`, `appInitialStateNavigation.test.js`, `achievementDisplayProjection.test.js` | Explicit session selection, route behavior, card click path, and display state. |
| Integrity | `achievementIntegrity.test.js` | Read-only data boundary, analysis logic, and evidence behavior. |
| Trading Cards | `tradingCards.test.js` | Classification, truthful monitor behavior, launch request policy, and separation from achievements. |
| IPC, credentials, persistence, diagnostics | `ipcValidation.test.js`, `stateIntegrity.test.js`, `settingsHooksImport.test.js`, `runtimeDiagnostics.test.js`, `steamApiClient.test.js` | Validation, state safety, secure credential UI contract, diagnostic contract, and API error normalization. |

When changing a focused feature, run the full suite before committing. It is acceptable to use a focused test during investigation, but final validation must include `npm test`.

## Build validation

```bash
npm run build
```

This validates the renderer bundle and configured electron-builder target. See [BUILD.md](BUILD.md) for packaging details and limitations.

## Repeatable Windows smoke-test checklist

Perform this on an appropriate Windows test environment with a known Steam account/test context. Record the artifact filename, full Git SHA, app version, Steam state, App ID, and screenshots/diagnostics where applicable.

### 1. Launch and shared chrome

- [ ] Launch the SHA-stamped Windows ZIP artifact.
- [ ] Confirm the application starts, renders its custom titlebar, and window controls work.
- [ ] Confirm Steam connected/disconnected state is displayed honestly.
- [ ] Confirm Dashboard, Library, Achievements, Trading Cards, Integrity, and Settings navigation responds.
- [ ] Confirm no new renderer/main-process errors are visible in the available diagnostic evidence.

### 2. Library and game selection

- [ ] Open Library with no active Humanized schedule.
- [ ] Select at least three different game cards using **Browse Achievements**.
- [ ] Confirm each click follows Library → selected game → Achievements.
- [ ] Confirm Dashboard reflects the new current selection.
- [ ] Confirm a truly running Humanized schedule still blocks switching to a different App ID.
- [ ] Confirm the schedule’s own App ID remains selectable where allowed.
- [ ] Confirm paused, completed, failed, or stale recovered schedule state does not incorrectly block normal game selection.

### 3. Instant achievement flow

Only use explicit, safe test achievements/account context.

- [ ] Select known locked achievements.
- [ ] Start the Instant queue.
- [ ] Verify the UI distinguishes local submission/acceptance from remote Steam confirmation.
- [ ] Observe a confirmed remote state when Steam reports it, or a pending/needs-attention state when it does not.
- [ ] Use recheck only as a verification action; confirm it does not issue a duplicate unlock.
- [ ] Confirm queue progress, errors, and technical error codes remain truthful.

### 4. Humanized / محاكاة الإنسان

- [ ] Create a schedule using each supported ordering mode as appropriate: Original, Natural / Story Progression, Most Common → Rarest, and Rarest → Most Common.
- [ ] Confirm grid order changes immediately when order selection changes before schedule generation.
- [ ] Confirm a persisted schedule is not mutated merely because display ordering changes later.
- [ ] Confirm selected order, visible grid order, and new schedule sequence agree.
- [ ] Confirm timing preset/localized labels and countdown refresh are live without changing persisted timestamps.
- [ ] Confirm a due item enters a distinct execution/verification lifecycle.
- [ ] Confirm pending verification does not activate the item again.
- [ ] Perform one controlled Pause → Resume cycle and verify queue identity/timestamps remain coherent.
- [ ] Perform one controlled application restart only when safe; verify the persisted schedule follows recovery policy rather than issuing duplicate activation.
- [ ] Confirm a completed/failed/paused schedule behaves correctly in Library selection safeguards.

### 5. Relock / إعادة قفل الإنجاز

Use only a test-safe achievement context.

- [ ] On an unlocked achievement, initiate Relock and inspect the explicit confirmation dialog.
- [ ] Confirm the action applies to one achievement, not a global reset.
- [ ] Confirm Relock is blocked while a Humanized schedule is running.
- [ ] Confirm local success remains pending until the remote state is observed.
- [ ] Confirm the card reaches locked state only after appropriate verification evidence.

### 6. Trading Cards

- [ ] Confirm card eligibility, no-card, exhausted, and unavailable states are labeled from actual evidence.
- [ ] Start a monitor only for an eligible/currently supported game state.
- [ ] Confirm **Launch requested** is not presented as confirmed running/active state.
- [ ] Confirm pause/stop wording does not claim the application closed the Steam game.
- [ ] Confirm no drops, remaining drops, exact drop time, or playtime is fabricated.

### 7. Achievement Integrity / سلامة الإنجازات

- [ ] Open Integrity and select a library game.
- [ ] Confirm it describes a read-only analysis and preserves the selected game’s data.
- [ ] Run a scan with available evidence.
- [ ] Confirm evidence, timeline, signals, and limitations display without modifying achievement state.
- [ ] Confirm tier wording remains descriptive/non-accusatory and does not imply a verdict of intent or legitimacy.

### 8. Arabic / English and RTL

This is a mandatory fresh v0.3.0 validation area.

- [ ] Set language to Arabic in Settings; confirm it takes effect immediately and persists after restart.
- [ ] Confirm Arabic desktop structure is **[Main Content] [Sidebar]**: main content left/center, Sidebar visibly on the right.
- [ ] Confirm Sidebar right border and active indicator appear on the right.
- [ ] Review Dashboard, Library, Achievements, محاكاة الإنسان, Trading Cards, سلامة الإنجازات, and Settings for surrounding English leakage.
- [ ] Confirm exact Arabic product terms: **محاكاة الإنسان**, **إعادة قفل الإنجاز**, **فتح الإنجاز**, **سلامة الإنجازات**, **فحص**, **تحليل**, **التفسير**, and the required Integrity tiers.
- [ ] Confirm game names, Steam-returned achievement names/descriptions, App IDs, Steam IDs, achievement IDs, URLs, API keys, and code values remain unmodified and LTR.
- [ ] Check normal and short-height desktop window behavior; Sidebar navigation should not scroll unnecessarily when space is sufficient, while genuinely constrained layouts remain usable.
- [ ] Switch back to English and confirm immediate polished LTR restoration with no Arabic/RTL leakage.

## Steam verification evidence

When a test depends on remote confirmation, preserve evidence that distinguishes:

| Evidence type | Interpretation |
|---|---|
| Local Steamworks result | The local call returned its result; this is not automatically remote confirmation. |
| Renderer pending/verification state | The application is waiting/reading within its policy; it is not evidence of success or failure by itself. |
| Steam Web API result | Remote observation used by verification. It can be delayed, unavailable, or affected by account/API conditions. |
| Steam client UI | User-visible client evidence; capture the relevant game/achievement context and timestamp. |
| Diagnostics | Helpful timing/path evidence when enabled; not a substitute for user-visible or remote confirmation. |

## Diagnostics

The project provides a diagnostic development launcher:

```bash
npm run dev:diagnostics
```

Use diagnostics to investigate a reproducible issue, then save/redact relevant output before sharing. Do not assume the presence of diagnostics proves that an event occurred; inspect the actual trace and preserve privacy-sensitive fields.

## Test documentation rule

Whenever a confirmed bug is fixed:

1. Add or strengthen an automated regression test where practical.
2. Update the relevant checklist if the manual acceptance criteria changed.
3. Record only completed manual validation in [PROJECT_STATUS.md](PROJECT_STATUS.md).
4. Keep unperformed Windows checks labeled as pending.

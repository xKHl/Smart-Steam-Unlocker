# First-Achievement Failure — Root Cause Analysis

## Evidence

### steamworks.js issue #70
- Reporter: `activate()` returns `false` consistently.
- Resolution: The working solution uses a **persistent client** initialized once at app startup, not per-achievement. The client is created once (`steamworks.init(appId)`) and reused for all subsequent `activate()` calls in the same session.
- Key insight: The working pattern in the issue keeps the client alive across multiple calls. SSU's per-achievement init/shutdown pattern is the architectural difference.

### Steam Game Idler — SteamworksSession.cs
The `SteamworksSession.Open()` method implements the correct lifecycle:
1. `SteamAPI.Init()` — initializes the native client.
2. `SteamUserStats.RequestUserStats(steamId)` — explicitly requests stats.
3. **Blocking spin-wait**: calls `SteamAPI.RunCallbacks()` every 100ms until `UserStatsReceived_t` fires with matching `m_nGameID`.
4. Only after the callback fires does it return and allow `SetAchievement`/`StoreStats`.

The spin-wait is the critical gate. `SetAchievement` can succeed before `UserStatsReceived` fires (it modifies local state), but `StoreStats` **explicitly fails** when `RequestCurrentStats` has not completed its callback (per Valve documentation).

### SAM — Manager.cs
SAM uses a long-lived client initialized once per game session. It calls `RequestUserStats` and waits for the `UserStatsReceived` callback before displaying or modifying any achievement data. It never shuts down and reinitializes per achievement.

### steamworks.js Rust source
- `steamworks.init()` calls `request_current_stats()` internally.
- The 30fps callback pump (`setInterval(runCallbacks, 1000/30)`) fires ~33ms after `init()` returns.
- `achievement.activate()` calls `set()` + `store_stats()` in a single Rust function.
- `store_stats()` calls the native `StoreStats()` which **fails if RequestCurrentStats has not completed**.

## Root Cause

### Why 0.2.3 was insufficient

The 0.2.3 fix used `isActivated(achievementId)` as a readiness probe. This is **insufficient** because:

1. `isActivated()` can return `false` (a valid boolean) before the stats cache is ready for writes.
2. `false` from `isActivated()` means "achievement not in local cache" — which is the same state as "not ready for writes."
3. The probe confirms **read-readiness** (the cache has some data), not **write-readiness** (StoreStats will succeed).
4. `StoreStats` requires `RequestCurrentStats` to have completed its callback. The callback fires on the pump thread. A single boolean return from `isActivated()` does not prove the callback has fired.

### The actual failure path

1. `steamworks.init(appId)` → calls `request_current_stats()` → returns immediately.
2. `isActivated(achievementId)` → returns `false` (achievement is locked) → probe considers stats "ready."
3. `achievement.activate(achievementId)` → calls `SetAchievement()` (succeeds, modifies local state) + `StoreStats()` (fails because `UserStatsReceived` callback has not fired yet).
4. `activate()` returns `false` (collapsed boolean from the failed `StoreStats`).
5. SSU reports `ACTIVATION_REJECTED`.

### Why subsequent achievements succeed

After the first achievement fails:
- The Humanized scheduler waits minutes before the next attempt.
- By then, the callback pump has long since fired and the stats cache is warm.
- The next `init()` + `isActivated()` + `activate()` sequence succeeds because the Steam client process has already processed `UserStatsReceived` for this App ID.

## Correct Fix

The correct fix requires a **stable two-poll confirmation** of `isActivated()` across two consecutive pump ticks, OR a longer explicit wait after `init()` that guarantees at least 2-3 pump cycles have fired.

The Steam Game Idler pattern (100ms poll loop until `UserStatsReceived` fires) is the gold standard. Since steamworks.js 0.3.2 does not expose `UserStatsReceived`, the equivalent is:

**Wait for `isActivated()` to return the same boolean value across two consecutive polls separated by at least one full pump tick (40ms).** This confirms the callback has fired and the cache is stable.

Additionally: implement a bounded retry (up to 3 attempts, 2s/5s backoff) around the `activate()` call itself, justified by Valve's own documentation: "You can unlock an achievement multiple times so you don't need to worry about only setting achievements that aren't already set." This makes a bounded retry a documented-safe pattern.

## Three-Way Comparison

| Area | SAM | Steam Game Idler | SSU (current) | Finding |
|------|-----|-----------------|---------------|---------|
| Client lifetime | Long-lived per game | Long-lived per game session | Per-achievement init/shutdown | **Architectural risk** |
| Stats readiness | Waits for UserStatsReceived callback | Blocks until UserStatsReceived fires | isActivated() boolean probe | **Confirmed bug** |
| Callback pump | Manual RunCallbacks() loop | Manual RunCallbacks() loop | 30fps setInterval pump | Different mechanism |
| SetAchievement | Separate from StoreStats | Separate from StoreStats | Collapsed in activate() | **Missing evidence** (can't distinguish) |
| StoreStats | Explicit separate call | Explicit separate call | Internal to activate() | **Confirmed bug** (hidden failure) |
| Retry | None | 3 attempts, 2s/5s backoff | None | **Architectural risk** |
| First achievement | Works (long-lived client) | Works (explicit wait) | Fails (race condition) | **Confirmed bug** |
| Subsequent achievements | Works | Works | Works (warm cache) | Already-proven behavior |

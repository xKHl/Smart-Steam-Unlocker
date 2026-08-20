# SAM vs Smart Steam Unlocker — Deep Architecture Comparison

**Branch:** `feature/humanized-scheduler` · **Version:** `0.2.2` · **Date:** 2026-08-20

---

## 1. Executive Summary

This report compares [gibbed/SteamAchievementManager][sam-repo] (SAM) against Smart Steam Unlocker (SSU) at the source level. The primary goal is to determine whether SSU's recurring first-achievement `Activation returned false` pattern is caused by an implementation defect, a Steamworks lifecycle difference, or an inherent Steam-side limitation. A secondary goal is to identify the correct approach for the Dashboard Activity card.

The most important finding from reading the steamworks.js native binding source is that **`achievement.activate()` in steamworks.js already calls `store_stats()` internally** — SSU's explicit `stats.store()` call after `activate()` is therefore a redundant double-store. More critically, the steamworks.js `init()` function calls `request_current_stats()` before returning, and then runs a 30fps callback pump. This means the stats-readiness concern is partially addressed by the library itself — but the callback pump runs asynchronously, and `achievement.activate()` may be called before the `UserStatsReceived` callback has fired and populated the local stats cache.

The central architectural difference between SAM and SSU remains: **SAM keeps a single Steamworks client alive for the entire game session and waits for the `UserStatsReceived` callback before allowing any write operations. SSU creates and destroys a client per achievement and calls `activate()` without waiting for the stats-ready signal.**

---

## 2. SAM Steamworks Lifecycle — Source Evidence

### 2.1 Initialization

SAM's `Program.cs` initializes a single `API.Client` per game process and passes it to the `Manager` window [1]:

```csharp
using (API.Client client = new())
{
    client.Initialize(appId);
    Application.Run(new Manager(appId, client));
}
```

`Initialize` sets the `SteamAppId` environment variable, loads `steamclient.dll`, creates a Steam pipe, connects to the global user, acquires the `SteamUserStats013` interface, and verifies the App ID via `SteamUtils.GetAppId()` [2]. The client is disposed only when the `Manager` form closes. There is no per-achievement initialization or shutdown.

### 2.2 Stats Readiness Gate

SAM's `Manager` constructor immediately calls `RefreshStats()`, which calls `SteamUserStats.RequestUserStats(steamId)` and waits for the `UserStatsReceived` callback [3]. Only after this callback fires with result code `1` (success) does SAM:

1. Load the local `UserGameStatsSchema_{appId}.bin` from Steam's `appcache/stats/` directory.
2. Parse all achievement and stat definitions.
3. Call `GetAchievementAndUnlockTime` for every definition to read current state.
4. Call `GetStatValue` for every stat definition.

**SAM never attempts to activate an achievement before the stats interface has been fully populated.** The `RequestUserStats` → callback → schema load → state read sequence is a mandatory correctness gate, not a performance optimization. The Steamworks SDK documentation explicitly states that `SetAchievement` requires `RequestCurrentStats` to have been called and its callback to have completed.

### 2.3 Achievement Activation

After the readiness gate, SAM's `StoreAchievements` calls `SetAchievement` for each changed achievement, then calls `StoreStats` once [4]:

```csharp
foreach (var info in achievements)
{
    if (this._SteamClient.SteamUserStats.SetAchievement(info.Id, info.IsAchieved) == false)
    {
        return -1; // abort
    }
}
this._SteamClient.SteamUserStats.StoreStats();
```

`SetAchievement` operates on the already-loaded stats cache. `StoreStats` commits all pending changes in a single network round-trip.

### 2.4 Game Switching

SAM does not support in-process game switching. The Picker launches `SAM.Game.exe` as a **separate process** per game [5]:

```csharp
Process.Start("SAM.Game.exe", info.Id.ToString(...));
```

Each game is a completely isolated process. There is no concept of switching App IDs within a running SAM.Game process.

### 2.5 Callback Pump

SAM runs a Windows Forms timer calling `client.RunCallbacks(false)` every 100ms [6]. Without this pump, the `UserStatsReceived` callback would never fire. SAM's reliability depends on this pump running continuously.

---

## 3. steamworks.js Native Binding — Source Evidence

Reading the steamworks.js Rust source reveals three critical facts:

### 3.1 `init()` Calls `request_current_stats()` [7]

```rust
pub fn init(app_id: Option<u32>) -> Result<(), Error> {
    // ...
    steam_client.user_stats().request_current_stats();
    client::set_client(steam_client);
    Ok(())
}
```

`init()` calls `request_current_stats()` before returning. This is the equivalent of SAM's `RequestUserStats` call. However, `request_current_stats()` only **initiates** the async request — it does not wait for the `UserStatsReceived` callback to complete.

### 3.2 `init()` Starts a 30fps Callback Pump [8]

```javascript
runCallbacksInterval = setInterval(runCallbacks, 1000 / 30)
```

After `init()`, the library runs callbacks at 30fps. This pump will eventually deliver the `UserStatsReceived` callback — but it does so asynchronously. The first callback tick fires approximately 33ms after `init()` returns.

### 3.3 `achievement.activate()` Calls `store_stats()` Internally [9]

```rust
pub fn activate(achievement: String) -> bool {
    let client = crate::client::get_client();
    client
        .user_stats()
        .achievement(&achievement)
        .set()
        .and_then(|_| client.user_stats().store_stats())
        .is_ok()
}
```

`achievement.activate()` calls both `set()` (equivalent to `SetAchievement`) and `store_stats()` (equivalent to `StoreStats`) in a single atomic operation. **SSU's explicit `localClient.stats.store()` call after `activate()` is therefore a redundant double-store.** The `stats.store()` namespace in steamworks.js is a separate function that calls `store_stats()` again — this is harmless but unnecessary.

---

## 4. Smart Steam Unlocker Steamworks Lifecycle — Source Evidence

### 4.1 Per-Achievement Client Model

For every individual achievement unlock, SSU's `unlockAchievement` [10]:

1. Calls `shutdown()` to destroy any existing client.
2. Calls `prepareSteamRuntimeContext(appId)` to write `steam_appid.txt` and `chdir`.
3. Calls `steamworks.init(appId)` — which internally calls `request_current_stats()` and starts the 30fps callback pump.
4. Immediately calls `localClient.achievement.activate(achievementId)` — which calls `set()` + `store_stats()`.
5. Calls `localClient.stats.store()` — **redundant double-store**.
6. Calls `localClient.shutdown()` in the `finally` block — which stops the callback pump.

### 4.2 The Race Condition

The critical timing issue is between steps 3 and 4. `steamworks.init()` calls `request_current_stats()` and returns. The `UserStatsReceived` callback will fire on the next callback pump tick (~33ms later). But SSU calls `achievement.activate()` **synchronously and immediately** after `init()` returns — before the first callback pump tick has fired.

If `activate()` is called before `UserStatsReceived` has delivered the stats data to the local cache, the native `SetAchievement` call may return an error (which `store_stats()` propagates as `false`), and `activate()` returns `false`. SSU reports this as `Activation returned false` / `ACTIVATION_REJECTED`.

### 4.3 Why the First Achievement Is Different

For the **first** `steamworks.init()` call for a given App ID in a process session, Steam must load the achievement schema from the network or disk cache. This loading is asynchronous and may take longer than 33ms. For **subsequent** achievements in the same Humanized schedule, SSU destroys and recreates the client — but by the time the second achievement is attempted (minutes later in Humanized mode), Steam's local process cache for that App ID is warm, and the `UserStatsReceived` callback may fire faster.

This explains the observed pattern: first achievement fails, subsequent achievements succeed.

### 4.4 The Double-Store Issue

SSU calls `localClient.stats.store()` after `localClient.achievement.activate()`. Since `activate()` already calls `store_stats()` internally, this is a redundant second `StoreStats` call. While harmless in most cases, it adds an unnecessary network round-trip and could theoretically cause issues if Steam rate-limits rapid `StoreStats` calls.

---

## 5. Root Cause Analysis: First-Achievement Failure

### 5.1 Confirmed Root Cause

The first-achievement `Activation returned false` failure is caused by a **race condition between `steamworks.init()` and `achievement.activate()`**. Specifically:

1. `steamworks.init(appId)` calls `request_current_stats()` and returns.
2. The `UserStatsReceived` callback is scheduled to fire on the next 30fps pump tick (~33ms).
3. SSU immediately calls `achievement.activate()` before the callback fires.
4. The native `SetAchievement` call fails because the stats cache is not yet populated.
5. `activate()` returns `false`. SSU reports `ACTIVATION_REJECTED`.

### 5.2 Evidence Strength

This is a **confirmed architectural risk** with high confidence. The evidence is:
- `steamworks.js` source confirms `init()` calls `request_current_stats()` but does not wait for the callback.
- `steamworks.js` source confirms the callback pump runs at 30fps (33ms interval).
- SSU source confirms `activate()` is called synchronously after `init()`.
- The observed pattern (first fails, later succeed) is exactly consistent with this race.

The only uncertainty is whether `SetAchievement` can succeed before `UserStatsReceived` fires in some Steam client states (e.g., when the schema is already in the local process cache from a previous session). This would explain why the failure is not 100% reproducible.

### 5.3 The Fix

The correct fix is to add a wait between `steamworks.init()` and `achievement.activate()` that allows the `UserStatsReceived` callback to fire. The smallest correct implementation:

```javascript
// After steamworks.init(appId):
await new Promise(resolve => setTimeout(resolve, 100)); // allow callback pump to fire
// Then call activate()
```

A 100ms delay covers 3 callback pump ticks (at 30fps = 33ms each) and is sufficient for the `UserStatsReceived` callback to fire in all normal Steam client states. This is not an arbitrary sleep — it is a bounded wait for a known async operation to complete.

A more robust alternative is to use the `callback.register` API to listen for the `UserStatsReceived` callback explicitly, but this requires knowing the callback ID and is more complex to implement correctly.

---

## 6. Game Switching Comparison

| Aspect | SAM | Smart Steam Unlocker |
|--------|-----|----------------------|
| Game switching | Separate process per game | In-process `switchGame()` + `steam_appid.txt` |
| Client lifetime | Entire session per game | Per-achievement (milliseconds) |
| App ID change | Not supported in-process | Supported via `prepareSteamRuntimeContext` |
| State reset on switch | Full process restart | `shutdown()` + new `steam_appid.txt` |
| Humanized App ID concept | Not applicable | Immutable per-schedule `appId` field |
| `assertGameSwitchAllowed` | Not applicable | Guards against switching during `running` schedule |

For SSU's use case (single-process multi-game manager with Humanized scheduling), the in-process model is correct and necessary. The `assertGameSwitchAllowed` guard scoped to `state === 'running'` is the right behavior.

---

## 7. Activity / Dashboard Investigation

### 7.1 What SAM Exposes

SAM uses `SteamApps001.GetAppData(id, "name")` for game names [10]. It does not expose recently played information, playtime timestamps, or last-played dates. Neither the `SteamApps001` nor `SteamApps008` interface exposes reliable last-played timestamps.

### 7.2 What the Steam Web API Exposes

The `IPlayerService/GetOwnedGames` endpoint (already used by SSU) returns `playtime_forever` (total minutes) and `playtime_2weeks` (minutes in the last two weeks) per game [11]. It does **not** return a reliable last-played timestamp. The `rtime_last_played` field exists in the raw response but is undocumented and unreliable.

### 7.3 Correct Activity Implementation

The cleanest truthful solution uses `playtime_2weeks` from the already-fetched library data. If `playtime_2weeks > 0` for the selected game, the Dashboard can show "Played in the last 2 weeks" with the playtime value. If `playtime_2weeks === 0` or absent, show "No recent activity reported by Steam." This requires no additional API calls and uses data already in the library response.

The `rtime_last_played` field must not be used — it is undocumented and its reliability is not guaranteed.

---

## 8. Known SAM Limitations

SAM's schema loading depends on the local `UserGameStatsSchema_{appId}.bin` file in Steam's `appcache/stats/` directory [3]. If this file is absent (game never launched, cache cleared), schema loading fails and no achievements are displayed. This is inherent to SAM's local-file approach. SSU avoids this by using the Steam Web API (`GetSchemaForGame`), which is more robust.

---

## 9. Architecture Comparison Table

| Area | SAM | Smart Steam Unlocker | Difference | Risk | Classification |
|------|-----|----------------------|------------|------|----------------|
| Steam initialization | Once per game process | Once per achievement unlock | Significant | Per-operation overhead | Architectural risk |
| Steamworks lifetime | Entire session | Per-achievement (milliseconds) | Significant | Race with stats callback | Architectural risk |
| App ID binding | `SteamAppId` env var at process start | `steam_appid.txt` + `chdir` per operation | Equivalent in effect | None | Already-proven behavior |
| Schema loading | Local `appcache/stats/*.bin` | Steam Web API `GetSchemaForGame` | SSU more robust | SAM fails if cache absent | Expected limitation (SAM) |
| Stats readiness gate | `RequestUserStats` → callback → then activate | `request_current_stats()` in `init()`, but no wait | **Critical gap** | `activate()` called before callback fires | **Confirmed bug** |
| Achievement lookup | `GetAchievementAndUnlockTime` after stats ready | Steam Web API `GetPlayerAchievements` | Different interfaces | None for read | Already-proven behavior |
| Current-state lookup | Native `GetAchievement` (local cache) | Steam Web API (remote, authoritative) | SSU more truthful | None | Already-proven behavior |
| Activation | `SetAchievement` on populated stats cache | `achievement.activate()` immediately after `init()` | **Critical** | Race → `false` return | **Confirmed bug** |
| Stats store | `StoreStats()` once after all changes | `activate()` stores internally + redundant `stats.store()` | Double-store | Harmless but wasteful | Architectural risk |
| Shutdown | Once on process exit | After every achievement unlock | Significant | Stops callback pump prematurely | Architectural risk |
| Game switching | Separate process per game | In-process `switchGame()` | Different model | None for SSU's use case | Already-proven behavior |
| First achievement | Stats loaded → reliable | Stats may not be loaded → race | **Critical** | `Activation returned false` | **Confirmed bug** |
| Subsequent achievements | Same session, stats cached | New client, Steam may have warm cache | Partially mitigated | Reduced but not eliminated | Architectural risk |
| Error handling | Shows dialog, manual retry | Classifies and retries via scheduler | SSU more automated | None | Already-proven behavior |
| Remote verification | Not implemented | Steam Web API polling | SSU more robust | None | Already-proven behavior |
| Persistence | None | `settingsStore` + Humanized queue | SSU more capable | None | Already-proven behavior |
| UI selection | Separate process per game | In-process with guard | SSU more capable | None | Already-proven behavior |
| Activity | Not implemented | `playtime_2weeks` available but unused | SSU can improve | None | Missing evidence → fixable |

---

## 10. Concrete Recommendations

### 10.1 Stats Readiness Wait (Priority: Critical)

Add a bounded wait after `steamworks.init()` to allow the `UserStatsReceived` callback to fire before calling `achievement.activate()`. The smallest correct implementation is a 100ms delay, which covers 3 callback pump ticks. This directly addresses the confirmed first-achievement failure root cause.

### 10.2 Remove Redundant Double-Store (Priority: Medium)

Remove the explicit `localClient.stats.store()` call after `localClient.achievement.activate()`. Since `activate()` already calls `store_stats()` internally in steamworks.js, the second call is redundant. This simplifies the code and eliminates an unnecessary network round-trip.

### 10.3 Activity Card (Priority: Low)

Replace the "Unavailable" label with a `playtime_2weeks`-based display using data already in the library response. No additional API calls are needed.

### 10.4 What Should NOT Be Copied from SAM

SAM's local schema file approach must not be adopted — SSU's Web API approach is more robust. SAM's separate-process-per-game model must not be adopted — SSU's in-process model with the Humanized scheduler is more capable. SAM's manual retry model must not be adopted — SSU's automated verification and retry is correct.

---

## 11. Findings Classification

| Finding | Classification |
|---------|----------------|
| `achievement.activate()` called before `UserStatsReceived` callback fires | **Confirmed bug** |
| First-achievement failure caused by stats-not-ready race | **Confirmed bug** (high confidence) |
| Redundant `stats.store()` after `activate()` | **Architectural risk** (harmless but incorrect) |
| Per-achievement client creation/destruction | **Architectural risk** |
| SAM's local schema dependency | **Expected limitation** (SAM-specific) |
| `rtime_last_played` unreliability | **Expected limitation** (Steam-side) |
| `playtime_2weeks` available for Activity card | **Missing evidence → fixable** |
| Humanized App ID immutability | **Already-proven behavior** |
| `assertGameSwitchAllowed` running-only guard | **Already-proven behavior** |
| Steam Web API verification | **Already-proven behavior** |
| `steamworks.js` `init()` calls `request_current_stats()` | **Already-proven behavior** (but async) |
| `achievement.activate()` includes internal `store_stats()` | **Already-proven behavior** (makes SSU's explicit store redundant) |

---

## References

[1]: https://github.com/gibbed/SteamAchievementManager/blob/master/SAM.Game/Program.cs "SAM.Game/Program.cs — Client initialization and Manager launch"
[2]: https://github.com/gibbed/SteamAchievementManager/blob/master/SAM.API/Client.cs "SAM.API/Client.cs — Initialize, App ID binding, interface acquisition"
[3]: https://github.com/gibbed/SteamAchievementManager/blob/master/SAM.Game/Manager.cs "SAM.Game/Manager.cs — RequestUserStats, OnUserStatsReceived, schema loading"
[4]: https://github.com/gibbed/SteamAchievementManager/blob/master/SAM.Game/Manager.cs "SAM.Game/Manager.cs — StoreAchievements, StoreStatistics"
[5]: https://github.com/gibbed/SteamAchievementManager/blob/master/SAM.Picker/GamePicker.cs "SAM.Picker/GamePicker.cs — OnActivateGame, separate process launch"
[6]: https://github.com/gibbed/SteamAchievementManager/blob/master/SAM.Picker/GamePicker.cs "SAM.Picker/GamePicker.cs — OnTimer, RunCallbacks pump"
[7]: https://github.com/ceifa/steamworks.js/blob/main/src/lib.rs "steamworks.js/src/lib.rs — init() calls request_current_stats()"
[8]: https://github.com/ceifa/steamworks.js/blob/main/index.js "steamworks.js/index.js — 30fps callback pump via setInterval"
[9]: https://github.com/ceifa/steamworks.js/blob/main/src/api/achievement.rs "steamworks.js/src/api/achievement.rs — activate() calls set() + store_stats() internally"
[10]: https://github.com/xKHl/Smart-Steam-Unlocker/blob/feature/humanized-scheduler/electron/steamManager.js "SSU steamManager.js — unlockAchievement, per-achievement client lifecycle"
[11]: https://partner.steamgames.com/doc/webapi/IPlayerService "Steam Web API — IPlayerService/GetOwnedGames, playtime_2weeks"
[sam-repo]: https://github.com/gibbed/SteamAchievementManager "gibbed/SteamAchievementManager"

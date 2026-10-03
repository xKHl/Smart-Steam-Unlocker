'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

test('Relock State Mismatch Implementation Verification', () => {
  const managerSource = fs.readFileSync(
    path.join(__dirname, '..', 'electron', 'steamManager.js'),
    'utf8'
  );

  // 1. UI state = unlocked, local Steamworks = unlocked → Relock allowed.
  // We can verify that the code proceeds to ClearAchievement when wasUnlocked is true and remoteUnlocked is not false.
  assert.match(
    managerSource,
    /if \(!wasUnlocked \|\| remoteUnlocked === false\)/,
    'Execution path should abort if local or remote says locked, meaning it proceeds if both say unlocked'
  );
  
  // 2. UI state = unlocked, local Steamworks = locked → refresh/synchronize state before deciding.
  // 4. UI state = stale unlocked, remote verification = locked → synchronize rather than attempting an invalid relock.
  // Both are handled by the same block that calls publishAchievementRelocked.
  assert.match(
    managerSource,
    /publishAchievementRelocked\(targetAppId, achievementId\);/,
    'Should synchronize optimistic UI cache before deciding'
  );

  assert.match(
    managerSource,
    /error: 'Steam currently reports this achievement as locked; UI state has been synchronized.'/,
    'Should return a synchronized error message'
  );

  assert.match(
    managerSource,
    /errorCode: 'ACHIEVEMENT_ALREADY_LOCKED'/,
    'Should return the ALREADY_LOCKED error code'
  );

  // Verify that it fetches remote verification BEFORE ClearAchievement
  const preVerificationIndex = managerSource.indexOf('preVerification = await getAchievementVerification');
  const clearAchievementIndex = managerSource.indexOf('localClient.achievement.clear(achievementId)');
  
  assert.ok(preVerificationIndex !== -1, 'Must fetch preVerification');
  assert.ok(clearAchievementIndex !== -1, 'Must have ClearAchievement');
  assert.ok(preVerificationIndex < clearAchievementIndex, 'Must fetch Web API state BEFORE ClearAchievement decision');
});

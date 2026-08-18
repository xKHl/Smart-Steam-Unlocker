const test = require('node:test');
const assert = require('node:assert/strict');

const {
  classifyExecutionFailure,
  createRealSteamExecutionAdapter,
  createRealSteamVerificationAdapter,
} = require('../electron/humanized/realSteamAdapters');
const {
  ITEM_STATUS,
  SCHEDULE_STATE,
  VERIFICATION,
  createScheduler,
} = require('../electron/humanized/schedulerEngine');

function context(overrides = {}) {
  return {
    appId: 480,
    achievementId: 'ACH_WIN',
    scheduleId: 'schedule-480',
    itemId: 'ACH_WIN',
    sequencePosition: 1,
    executionToken: 'schedule-480:ACH_WIN:1:1000',
    ...overrides,
  };
}

function fakeSteamManager(overrides = {}) {
  return {
    getSelectedAppId: () => 480,
    unlockAchievement: async () => ({ success: true, achievementId: 'ACH_WIN', appId: 480 }),
    getAchievementVerification: async () => ({ success: true, appId: 480, achievementId: 'ACH_WIN', unlocked: true }),
    ...overrides,
  };
}

test('real execution adapter validates immutable App-ID context before invoking Steam', async () => {
  let calls = 0;
  const steamManager = fakeSteamManager({
    unlockAchievement: async (achievementId, appId) => {
      calls += 1;
      assert.equal(achievementId, 'ACH_WIN');
      assert.equal(appId, 480);
      return { success: true, achievementId, appId };
    },
  });
  const adapter = createRealSteamExecutionAdapter({ steamManager });

  assert.deepEqual(await adapter.validateContext(context()), { valid: true });
  assert.equal((await adapter.executeUnlock(context())).outcome, 'success');
  assert.equal(calls, 1);

  const mismatch = context({ appId: 481 });
  assert.equal((await adapter.validateContext(mismatch)).outcome, 'failed');
  const rejected = await adapter.executeUnlock(mismatch);
  assert.equal(rejected.outcome, 'failed');
  assert.equal(calls, 1);
});

test('real execution adapter rejects missing required context and normalizes Steam failures', async () => {
  const adapter = createRealSteamExecutionAdapter({ steamManager: fakeSteamManager() });
  assert.equal((await adapter.executeUnlock({ appId: 480 })).outcome, 'failed');

  assert.deepEqual(classifyExecutionFailure({ errorCode: 'APP_ID_MISMATCH', error: 'Wrong app' }), {
    outcome: 'failed', verification: 'unverified', error: 'Wrong app',
  });
  assert.deepEqual(classifyExecutionFailure({ errorCode: 'STEAM_EXECUTION_FAILED', error: 'Steam initialization failed' }), {
    outcome: 'retry', verification: 'unverified', error: 'Steam initialization failed',
  });
  assert.deepEqual(classifyExecutionFailure({ errorCode: 'OPERATION_UNCERTAIN', operationMayHaveApplied: true, error: 'Store failed' }), {
    outcome: 'uncertain', verification: 'uncertain', error: 'Store failed',
  });
  assert.deepEqual(classifyExecutionFailure({ errorCode: 'ACHIEVEMENT_NOT_FOUND', error: 'Not found' }), {
    outcome: 'failed', verification: 'unverified', error: 'Not found',
  });
});

test('real verifier distinguishes confirmed unlock, confirmed non-completion, and unavailable reads', async () => {
  const schedule = { id: 'schedule-480', appId: 480 };
  const item = { id: 'ACH_WIN', executionContext: context() };
  const request = { schedule, item, executionResult: { context: context() } };

  let verifier = createRealSteamVerificationAdapter({ steamManager: fakeSteamManager() });
  assert.deepEqual(await verifier.verify(request), { verification: 'verified' });

  verifier = createRealSteamVerificationAdapter({
    steamManager: fakeSteamManager({ getAchievementVerification: async () => ({ success: true, unlocked: false }) }),
  });
  assert.deepEqual(await verifier.verify(request), {
    verification: 'unverified', retryable: true, error: 'Steam reports that the achievement is not unlocked.',
  });

  verifier = createRealSteamVerificationAdapter({
    steamManager: fakeSteamManager({ getAchievementVerification: async () => ({ success: false, errorCode: 'STEAM_READ_UNAVAILABLE', error: 'Offline' }) }),
  });
  assert.deepEqual(await verifier.verify(request), { verification: 'uncertain', error: 'Offline' });

  verifier = createRealSteamVerificationAdapter({
    steamManager: fakeSteamManager({ getAchievementVerification: async () => ({ success: false, errorCode: 'APP_ID_MISMATCH', error: 'Wrong app' }) }),
  });
  assert.deepEqual(await verifier.verify(request), { verification: 'failed', error: 'Wrong app' });
});

test('real adapter abstraction preserves verifier-first recovery and prevents a second execution when already unlocked', async () => {
  let unlockCalls = 0;
  const steamManager = fakeSteamManager({
    unlockAchievement: async () => {
      unlockCalls += 1;
      return { success: true };
    },
    getAchievementVerification: async () => ({ success: true, unlocked: true }),
  });
  const scheduler = createScheduler({
    executor: createRealSteamExecutionAdapter({ steamManager }),
    verifier: createRealSteamVerificationAdapter({ steamManager }),
    now: () => 1_000,
    persist: () => true,
  });
  await scheduler.load({
    version: 2,
    id: 'schedule-480',
    appId: 480,
    state: SCHEDULE_STATE.RUNNING,
    items: [{
      id: 'ACH_WIN', sequencePosition: 1, status: ITEM_STATUS.EXECUTING,
      attempts: 1, maxRetries: 2, executionToken: 'interrupted-token', scheduledAt: 0,
    }],
  });
  await scheduler.start();
  await scheduler.processDue();

  const recovered = scheduler.getSchedule();
  assert.equal(recovered.items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(recovered.items[0].verification, VERIFICATION.VERIFIED);
  assert.equal(unlockCalls, 0);
});


test('real execution adapter rejects a missing App ID before Steam is called', async () => {
  let calls = 0;
  const adapter = createRealSteamExecutionAdapter({
    steamManager: fakeSteamManager({ unlockAchievement: async () => { calls += 1; return { success: true }; } }),
  });
  const result = await adapter.executeUnlock(context({ appId: null }));
  assert.equal(result.outcome, 'failed');
  assert.match(result.error, /App ID/);
  assert.equal(calls, 0);
});

test('real verifier confirmed non-completion produces a controlled retry rather than completion', async () => {
  const steamManager = fakeSteamManager({
    getAchievementVerification: async () => ({ success: true, unlocked: false }),
  });
  const scheduler = createScheduler({
    executor: createRealSteamExecutionAdapter({ steamManager }),
    verifier: createRealSteamVerificationAdapter({ steamManager }),
    now: () => 2_000,
    persist: () => true,
  });
  await scheduler.setSchedule({
    version: 2,
    id: 'schedule-480',
    appId: 480,
    state: SCHEDULE_STATE.PAUSED,
    items: [{
      id: 'ACH_WIN', sequencePosition: 1, status: ITEM_STATUS.SCHEDULED,
      attempts: 0, maxRetries: 2, scheduledAt: 0, executionToken: null,
    }],
  });
  await scheduler.start();
  await scheduler.processDue();

  const current = scheduler.getSchedule();
  assert.equal(current.state, SCHEDULE_STATE.PAUSED);
  assert.equal(current.items[0].status, ITEM_STATUS.RETRY);
  assert.equal(current.items[0].verification, VERIFICATION.UNVERIFIED);
});


test('post-activation store API failure is verifier-first and completes when Steam confirms the unlock', async () => {
  let unlockCalls = 0;
  let verificationCalls = 0;
  let refreshCalls = 0;
  const steamManager = fakeSteamManager({
    unlockAchievement: async () => {
      unlockCalls += 1;
      return {
        success: false,
        errorCode: 'OPERATION_UNCERTAIN',
        operationMayHaveApplied: true,
        error: 'localClient.achievement.store is not a function',
      };
    },
    getAchievementVerification: async () => {
      verificationCalls += 1;
      return { success: true, unlocked: true };
    },
    confirmVerifiedAchievement: () => { refreshCalls += 1; },
  });
  const scheduler = createScheduler({
    executor: createRealSteamExecutionAdapter({ steamManager }),
    verifier: createRealSteamVerificationAdapter({ steamManager }),
    now: () => 3_000,
    persist: () => true,
  });

  await scheduler.setSchedule({
    version: 2,
    id: 'schedule-480',
    appId: 480,
    state: SCHEDULE_STATE.PAUSED,
    items: [{ id: 'ACH_WIN', sequencePosition: 1, status: ITEM_STATUS.SCHEDULED, attempts: 0, maxRetries: 2, scheduledAt: 0, executionToken: null }],
  });
  await scheduler.start();
  await scheduler.processDue();

  const current = scheduler.getSchedule();
  assert.equal(unlockCalls, 1);
  assert.equal(verificationCalls, 1);
  assert.equal(refreshCalls, 1);
  assert.equal(current.items[0].status, ITEM_STATUS.COMPLETED);
  assert.equal(current.items[0].verification, VERIFICATION.VERIFIED);
});

test('post-activation store API failure permits controlled retry only after verification confirms non-completion', async () => {
  let unlockCalls = 0;
  const steamManager = fakeSteamManager({
    unlockAchievement: async () => {
      unlockCalls += 1;
      return {
        success: false,
        errorCode: 'OPERATION_UNCERTAIN',
        operationMayHaveApplied: true,
        error: 'localClient.achievement.store is not a function',
      };
    },
    getAchievementVerification: async () => ({ success: true, unlocked: false }),
  });
  const scheduler = createScheduler({
    executor: createRealSteamExecutionAdapter({ steamManager }),
    verifier: createRealSteamVerificationAdapter({ steamManager }),
    now: () => 4_000,
    persist: () => true,
  });

  await scheduler.setSchedule({
    version: 2,
    id: 'schedule-480',
    appId: 480,
    state: SCHEDULE_STATE.PAUSED,
    items: [{ id: 'ACH_WIN', sequencePosition: 1, status: ITEM_STATUS.SCHEDULED, attempts: 0, maxRetries: 2, scheduledAt: 0, executionToken: null }],
  });
  await scheduler.start();
  await scheduler.processDue();

  const current = scheduler.getSchedule();
  assert.equal(unlockCalls, 1);
  assert.equal(current.state, SCHEDULE_STATE.PAUSED);
  assert.equal(current.items[0].status, ITEM_STATUS.RETRY);
  assert.equal(current.items[0].verification, VERIFICATION.UNVERIFIED);
});

test('post-activation store API failure stays paused when real verification is uncertain', async () => {
  let unlockCalls = 0;
  const steamManager = fakeSteamManager({
    unlockAchievement: async () => {
      unlockCalls += 1;
      return {
        success: false,
        errorCode: 'OPERATION_UNCERTAIN',
        operationMayHaveApplied: true,
        error: 'localClient.achievement.store is not a function',
      };
    },
    getAchievementVerification: async () => ({ success: false, errorCode: 'STEAM_READ_UNAVAILABLE', error: 'Steam Web API is delayed' }),
  });
  const scheduler = createScheduler({
    executor: createRealSteamExecutionAdapter({ steamManager }),
    verifier: createRealSteamVerificationAdapter({ steamManager }),
    now: () => 5_000,
    persist: () => true,
  });

  await scheduler.setSchedule({
    version: 2,
    id: 'schedule-480',
    appId: 480,
    state: SCHEDULE_STATE.PAUSED,
    items: [{ id: 'ACH_WIN', sequencePosition: 1, status: ITEM_STATUS.SCHEDULED, attempts: 0, maxRetries: 2, scheduledAt: 0, executionToken: null }],
  });
  await scheduler.start();
  await scheduler.processDue();

  const current = scheduler.getSchedule();
  assert.equal(unlockCalls, 1);
  assert.equal(current.state, SCHEDULE_STATE.PAUSED);
  assert.equal(current.items[0].status, ITEM_STATUS.VERIFICATION_REQUIRED);
  assert.equal(current.items[0].verification, VERIFICATION.UNCERTAIN);
});

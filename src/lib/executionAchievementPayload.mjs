// Renderer achievement view models may include read-only fields used by local
// displays (for example Steam's unlockTime evidence). Execution IPC accepts only
// the canonical scheduler/timer achievement contract. Keep this projection at
// the renderer boundary rather than widening the main-process validator.
const EXECUTION_ACHIEVEMENT_FIELDS = Object.freeze([
  'id',
  'name',
  'description',
  'originalIndex',
  'globalPercent',
  'hidden',
  'unlocked',
]);

export function projectExecutionAchievement(achievement) {
  const source = achievement && typeof achievement === 'object' ? achievement : {};
  const projected = {};
  for (const field of EXECUTION_ACHIEVEMENT_FIELDS) {
    if (source[field] !== undefined) projected[field] = source[field];
  }
  return projected;
}

export function projectExecutionAchievements(achievements) {
  return Array.isArray(achievements)
    ? achievements.map(projectExecutionAchievement)
    : [];
}

export { EXECUTION_ACHIEVEMENT_FIELDS };

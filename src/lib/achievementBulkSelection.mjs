export function visibleLockedAchievementIds(displayedAchievements) {
  return (Array.isArray(displayedAchievements) ? displayedAchievements : [])
    .filter((achievement) => achievement && !achievement.unlocked)
    .map((achievement) => achievement.id)
    .filter(Boolean);
}

export function areAllVisibleLockedSelected(selectedIds, visibleLockedIds) {
  const selected = selectedIds instanceof Set ? selectedIds : new Set();
  return visibleLockedIds.length > 0 && visibleLockedIds.every((id) => selected.has(id));
}

/**
 * Adds visible locked IDs at the end of the existing selection, in current grid
 * order. Existing manual selections retain their insertion order and are never
 * silently renumbered. The caller may use `removeVisibleLockedSelection` for a
 * visible-subset toggle without affecting selections outside the current view.
 */
export function addVisibleLockedSelection(selectedIds, visibleLockedIds) {
  const next = new Set(selectedIds instanceof Set ? selectedIds : []);
  for (const id of visibleLockedIds) next.add(id);
  return next;
}

export function removeVisibleLockedSelection(selectedIds, visibleLockedIds) {
  const toRemove = new Set(visibleLockedIds);
  return new Set(Array.from(selectedIds instanceof Set ? selectedIds : []).filter((id) => !toRemove.has(id)));
}

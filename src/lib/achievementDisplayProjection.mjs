export function achievementOrderRevision(achievements) {
  if (!Array.isArray(achievements)) return '';
  return achievements
    .map((achievement) => [
      achievement?.id ?? '',
      achievement?.originalIndex ?? '',
      achievement?.globalPercent ?? '',
    ].join('\u0001'))
    .join('\u0002');
}

/**
 * Projects the canonical achievement dataset into the list rendered by the grid.
 * Ordering is never computed here: orderedIds must come from the main-process
 * canonical ordering module. This helper only joins IDs back to current objects
 * and applies existing UI filters.
 */
export function projectAchievementDisplay({
  achievements,
  orderedIds,
  useCanonicalOrder,
  search = '',
  filter = 'All',
}) {
  const source = Array.isArray(achievements) ? achievements : [];
  const canonicalOrderAvailable = useCanonicalOrder && Array.isArray(orderedIds);
  const byId = canonicalOrderAvailable
    ? new Map(source.map((achievement) => [achievement.id, achievement]))
    : null;

  let displayed = canonicalOrderAvailable
    ? orderedIds.map((id) => byId.get(id)).filter(Boolean)
    : [...source];

  const query = String(search).trim().toLowerCase();
  if (query) {
    displayed = displayed.filter((achievement) => (
      (achievement.name || achievement.id || '').toLowerCase().includes(query)
    ));
  }

  if (filter === 'Locked') displayed = displayed.filter((achievement) => !achievement.unlocked);
  if (filter === 'Unlocked') displayed = displayed.filter((achievement) => achievement.unlocked);

  return displayed;
}

export const INTEGRITY_TIERS = Object.freeze({
  NORMAL: 'normal',
  UNUSUAL: 'unusual',
  HIGH: 'high',
  EXTREME: 'extreme',
});

export const INTEGRITY_TIER_COPY = Object.freeze({
  [INTEGRITY_TIERS.NORMAL]: {
    label: 'Normal',
    description: 'No material anomaly signal was found in the Steam evidence available to this scan.',
  },
  [INTEGRITY_TIERS.UNUSUAL]: {
    label: 'Unusual',
    description: 'One or more non-conclusive patterns deserve context before drawing conclusions.',
  },
  [INTEGRITY_TIERS.HIGH]: {
    label: 'High Anomaly',
    description: 'Several observed patterns are atypical. This is an evidence summary, not a determination of intent.',
  },
  [INTEGRITY_TIERS.EXTREME]: {
    label: 'Extreme Anomaly',
    description: 'Multiple strong timing and progression signals were observed. The result remains descriptive, not a verdict.',
  },
});

const DAY_SECONDS = 24 * 60 * 60;
const BURST_WINDOW_SECONDS = 5 * 60;
const MIN_TIMED_ACHIEVEMENTS_FOR_BURST = 4;
const MIN_TIMED_ACHIEVEMENTS_FOR_PROGRESSION = 4;
const LOW_PLAYTIME_MINUTES = 15;
const HIGH_COMPLETION_RATIO = 0.75;
const HIGH_PLAYTIME_UNLOCK_COUNT = 8;
const LOW_PLAYTIME_UNLOCK_COUNT = 3;

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizedUnlock(achievement) {
  return Boolean(achievement?.unlocked);
}

function normalizedUnlockTime(achievement) {
  const value = finiteNumber(achievement?.unlockTime);
  return value && value > 0 ? value : null;
}

function titleFor(achievement) {
  return achievement?.name || achievement?.id || 'Unnamed achievement';
}

function addSignal(signals, signal) {
  signals.push({
    id: signal.id,
    title: signal.title,
    summary: signal.summary,
    severity: signal.severity,
    evidence: signal.evidence,
    points: signal.points,
  });
}

export function buildEvidenceTimeline(achievements = []) {
  return achievements
    .filter((achievement) => normalizedUnlock(achievement) && normalizedUnlockTime(achievement))
    .map((achievement) => ({
      id: achievement.id,
      name: titleFor(achievement),
      unlockTime: normalizedUnlockTime(achievement),
      originalIndex: finiteNumber(achievement.originalIndex) ?? Number.MAX_SAFE_INTEGER,
      globalPercent: finiteNumber(achievement.globalPercent),
      hidden: Boolean(achievement.hidden),
    }))
    .sort((left, right) => left.unlockTime - right.unlockTime
      || left.originalIndex - right.originalIndex
      || String(left.id).localeCompare(String(right.id)));
}

function tierFor(score) {
  if (score >= 70) return INTEGRITY_TIERS.EXTREME;
  if (score >= 40) return INTEGRITY_TIERS.HIGH;
  if (score >= 15) return INTEGRITY_TIERS.UNUSUAL;
  return INTEGRITY_TIERS.NORMAL;
}

function timingSignal(timeline, signals) {
  if (timeline.length < MIN_TIMED_ACHIEVEMENTS_FOR_BURST) return null;

  let best = null;
  let left = 0;
  for (let right = 0; right < timeline.length; right += 1) {
    while (timeline[right].unlockTime - timeline[left].unlockTime > BURST_WINDOW_SECONDS) left += 1;
    const count = right - left + 1;
    if (!best || count > best.count) {
      best = {
        count,
        first: timeline[left].unlockTime,
        last: timeline[right].unlockTime,
      };
    }
  }

  if (!best || best.count < MIN_TIMED_ACHIEVEMENTS_FOR_BURST) return null;
  const duration = Math.max(0, best.last - best.first);
  const points = best.count >= 12 ? 45 : best.count >= 8 ? 30 : 15;
  const severity = points >= 45 ? 'strong' : points >= 30 ? 'moderate' : 'context';
  addSignal(signals, {
    id: 'timing-burst',
    title: 'Compressed unlock timing',
    summary: `${best.count} Steam-reported achievement timestamps fall within ${duration <= 60 ? `${duration} seconds` : `${Math.ceil(duration / 60)} minutes`}.`,
    severity,
    points,
    evidence: {
      achievementCount: best.count,
      windowSeconds: duration,
      firstUnlockTime: best.first,
      lastUnlockTime: best.last,
    },
  });
  return best;
}

function playtimeSignal({ achievements, unlocked, playtimeMinutes }, signals) {
  if (playtimeMinutes === null || unlocked === 0) return;
  const completionRatio = achievements.length ? unlocked / achievements.length : 0;
  const highCompletionAtLowPlaytime = playtimeMinutes <= LOW_PLAYTIME_MINUTES
    && (unlocked >= HIGH_PLAYTIME_UNLOCK_COUNT || completionRatio >= HIGH_COMPLETION_RATIO);
  const meaningfulUnlocksAtLowPlaytime = playtimeMinutes <= LOW_PLAYTIME_MINUTES && unlocked >= LOW_PLAYTIME_UNLOCK_COUNT;

  if (!highCompletionAtLowPlaytime && !meaningfulUnlocksAtLowPlaytime) return;
  const points = highCompletionAtLowPlaytime ? 30 : 15;
  addSignal(signals, {
    id: 'playtime-achievement-ratio',
    title: 'Achievement count relative to reported playtime',
    summary: `Steam reports ${unlocked} unlocked achievement${unlocked === 1 ? '' : 's'} and ${playtimeMinutes} minute${playtimeMinutes === 1 ? '' : 's'} of library playtime.`,
    severity: highCompletionAtLowPlaytime ? 'moderate' : 'context',
    points,
    evidence: {
      unlocked,
      totalAchievements: achievements.length,
      completionRatio,
      playtimeMinutes,
    },
  });
}

function progressionSignal(timeline, signals) {
  if (timeline.length < MIN_TIMED_ACHIEVEMENTS_FOR_PROGRESSION) return;
  let invertedTransitions = 0;
  for (let index = 1; index < timeline.length; index += 1) {
    if (timeline[index].originalIndex < timeline[index - 1].originalIndex) invertedTransitions += 1;
  }
  const transitionCount = timeline.length - 1;
  const inversionRatio = transitionCount ? invertedTransitions / transitionCount : 0;
  if (inversionRatio < 0.75 || timeline.length < 6) return;

  const points = inversionRatio === 1 ? 20 : 10;
  addSignal(signals, {
    id: 'progression-order',
    title: 'Non-sequential schema progression',
    summary: `${invertedTransitions} of ${transitionCount} adjacent timestamped unlocks move backward relative to Steam's schema order.`,
    severity: points >= 20 ? 'moderate' : 'context',
    points,
    evidence: {
      invertedTransitions,
      transitionCount,
      inversionRatio,
    },
  });
}

export function analyzeAchievementIntegrity({ achievements = [], game = null } = {}) {
  const safeAchievements = Array.isArray(achievements) ? achievements : [];
  const unlocked = safeAchievements.filter(normalizedUnlock).length;
  const timeline = buildEvidenceTimeline(safeAchievements);
  const signals = [];
  const playtimeMinutes = finiteNumber(game?.playtimeMinutes);

  const burst = timingSignal(timeline, signals);
  playtimeSignal({ achievements: safeAchievements, unlocked, playtimeMinutes }, signals);
  progressionSignal(timeline, signals);

  const score = Math.min(100, signals.reduce((total, signal) => total + signal.points, 0));
  const tier = tierFor(score);
  const timelineCoverage = unlocked ? timeline.length / unlocked : 0;
  const limitations = [];
  if (!safeAchievements.length) limitations.push('Steam did not return achievement definitions for this game.');
  if (unlocked && !timeline.length) limitations.push('Steam reported unlocked achievements but did not provide usable unlock timestamps for this scan.');
  if (unlocked && timelineCoverage < 1) limitations.push(`${unlocked - timeline.length} unlocked achievement${unlocked - timeline.length === 1 ? '' : 's'} lack a Steam-reported timestamp and are not placed on the timeline.`);
  if (playtimeMinutes === null) limitations.push('Library playtime was not available, so no playtime-to-achievement signal was evaluated.');
  if (timeline.length < MIN_TIMED_ACHIEVEMENTS_FOR_BURST) limitations.push('There are too few timestamped unlocks to evaluate compressed timing reliably.');

  return {
    tier,
    score,
    tierCopy: INTEGRITY_TIER_COPY[tier],
    scannedAt: Math.floor(Date.now() / 1000),
    summary: {
      totalAchievements: safeAchievements.length,
      unlockedAchievements: unlocked,
      lockedAchievements: Math.max(0, safeAchievements.length - unlocked),
      timestampedUnlocks: timeline.length,
      playtimeMinutes,
      completionRatio: safeAchievements.length ? unlocked / safeAchievements.length : 0,
    },
    signals,
    timeline,
    limitations,
    context: {
      burstWindowSeconds: BURST_WINDOW_SECONDS,
      daySeconds: DAY_SECONDS,
      steamReportedTimelineOnly: true,
      analysisLocalOnly: true,
    },
    bestTimingBurst: burst,
  };
}

export function formatIntegrityDate(unlockTime, locale = undefined) {
  const value = finiteNumber(unlockTime);
  if (!value || value <= 0) return 'No Steam timestamp';
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value * 1000));
}

export function formatIntegrityDuration(seconds) {
  const value = Math.max(0, Math.floor(finiteNumber(seconds) || 0));
  if (value < 60) return `${value}s`;
  if (value < 3600) return `${Math.floor(value / 60)}m ${value % 60}s`;
  return `${Math.floor(value / 3600)}h ${Math.floor((value % 3600) / 60)}m`;
}

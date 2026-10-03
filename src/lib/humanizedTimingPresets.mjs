export const MINUTE_MS = 60_000;

export const HUMANIZED_TIMING_PRESETS = Object.freeze([
  {
    id: 'fast',
    label: 'Fast',
    description: 'Short, varied spacing for a brief session',
    initialDelayMinutes: 1,
    baseIntervalMinutes: 4,
    varianceMinutes: 1,
    minIntervalMinutes: 3,
    maxIntervalMinutes: 6,
  },
  {
    id: 'natural',
    label: 'Natural',
    description: 'A balanced pace with noticeable variation',
    initialDelayMinutes: 3,
    baseIntervalMinutes: 10,
    varianceMinutes: 3,
    minIntervalMinutes: 6,
    maxIntervalMinutes: 16,
  },
  {
    id: 'relaxed',
    label: 'Relaxed',
    description: 'Longer spacing for an unhurried progression',
    initialDelayMinutes: 8,
    baseIntervalMinutes: 24,
    varianceMinutes: 6,
    minIntervalMinutes: 15,
    maxIntervalMinutes: 36,
  },
]);

export const DEFAULT_TIMING_PRESET = 'natural';

export function timingPresetById(id) {
  return HUMANIZED_TIMING_PRESETS.find((preset) => preset.id === id) ?? HUMANIZED_TIMING_PRESETS.find((preset) => preset.id === DEFAULT_TIMING_PRESET);
}

export function timingOptionsFromMinutes(timing) {
  return {
    initialDelayMs: Math.round(Number(timing.initialDelayMinutes) * MINUTE_MS),
    baseIntervalMs: Math.round(Number(timing.baseIntervalMinutes) * MINUTE_MS),
    varianceMs: Math.round(Number(timing.varianceMinutes) * MINUTE_MS),
    minIntervalMs: Math.round(Number(timing.minIntervalMinutes) * MINUTE_MS),
    maxIntervalMs: Math.round(Number(timing.maxIntervalMinutes) * MINUTE_MS),
  };
}

export function durationLabel(milliseconds) {
  const totalSeconds = Math.max(0, Math.round(Number(milliseconds) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
}

export function remainingLabel(timestamp, now = Date.now()) {
  if (!Number.isFinite(timestamp)) return 'Time pending';
  return timestamp <= now ? 'Due now' : `in ${durationLabel(timestamp - now)}`;
}

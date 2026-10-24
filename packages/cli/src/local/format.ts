const UNITS = ['B', 'KB', 'MB', 'GB'];

/** `1536` as `1.5 KB`: one decimal from KB up, whole bytes below. */
export const formatBytes = (opts: { bytes: number }): string => {
  let value = opts.bytes;
  let unit = 0;

  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }

  return unit === 0 ? `${value} B` : `${value.toFixed(1)} ${UNITS[unit]}`;
};

/** An age in the largest whole unit: `5m`, `3h`, `2d`. */
export const formatAge = (opts: { ageMs: number }): string => {
  const minutes = Math.floor(opts.ageMs / 60_000);

  if (minutes < 60) {
    return `${Math.max(minutes, 0)}m`;
  }

  return minutes < 60 * 24 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / (60 * 24))}d`;
};

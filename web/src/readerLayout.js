export const READER_SPLIT_MIN = 34;
export const READER_SPLIT_MAX = 72;
export const READER_SPLIT_DEFAULT = 48;

export function clampReaderSplit(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return READER_SPLIT_DEFAULT;
  return Math.max(READER_SPLIT_MIN, Math.min(READER_SPLIT_MAX, Math.round(numeric)));
}

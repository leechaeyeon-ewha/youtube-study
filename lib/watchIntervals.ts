export type WatchedInterval = [number, number];

const DEFAULT_MERGE_GAP_SEC = 1;

/** JSON/unknown → 유효한 [start, end] 배열 */
export function normalizeIntervals(raw: unknown): WatchedInterval[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchedInterval[] = [];
  for (const item of raw) {
    if (!Array.isArray(item) || item.length < 2) continue;
    const start = Number(item[0]);
    const end = Number(item[1]);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    if (start < 0 || end <= start) continue;
    out.push([start, end]);
  }
  return out;
}

/** 겹치거나 gapSec 이내 인접 구간 병합 */
export function mergeIntervals(
  intervals: WatchedInterval[],
  gapSec = DEFAULT_MERGE_GAP_SEC
): WatchedInterval[] {
  if (intervals.length === 0) return [];
  if (intervals.length === 1) return [[intervals[0][0], intervals[0][1]]];

  const sorted = [...intervals].sort((a, b) => a[0] - b[0]);
  const merged: WatchedInterval[] = [];
  let cur: WatchedInterval = [sorted[0][0], sorted[0][1]];

  for (let i = 1; i < sorted.length; i++) {
    const [s, e] = sorted[i];
    if (s <= cur[1] + gapSec) {
      cur[1] = Math.max(cur[1], e);
    } else {
      merged.push(cur);
      cur = [s, e];
    }
  }
  merged.push(cur);
  return merged;
}

/** 병합 후 총 시청 시간(초) */
export function totalWatchedSeconds(intervals: WatchedInterval[]): number {
  return mergeIntervals(intervals).reduce((sum, [s, e]) => sum + (e - s), 0);
}

/** 진행 중 구간을 포함한 임시 병합 후 퍼센트 (0~100) */
export function percentFromIntervals(
  intervals: WatchedInterval[],
  durationSec: number,
  openSegment?: WatchedInterval | null
): number {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return 0;
  const all =
    openSegment && openSegment[1] > openSegment[0]
      ? [...intervals, openSegment]
      : intervals;
  const total = totalWatchedSeconds(all);
  const percent = (total / durationSec) * 100;
  return Math.min(100, Math.max(0, Math.round(percent * 100) / 100));
}

export const COMPLETE_THRESHOLD_PERCENT = 95;

/** DB/클라이언트 공통 — 시청 완료(복습 가능) 판정 */
export function isWatchComplete(
  progressPercent: number | null | undefined,
  isCompleted?: boolean | null
): boolean {
  return isCompleted === true || (progressPercent ?? 0) >= COMPLETE_THRESHOLD_PERCENT;
}

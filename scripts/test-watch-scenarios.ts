/**
 * 시청 구간 기반 진도율 시나리오 1~8 검증 (로직 시뮬레이션)
 * 실행: npx tsx scripts/test-watch-scenarios.ts
 */
import {
  COMPLETE_THRESHOLD_PERCENT,
  mergeIntervals,
  normalizeIntervals,
  percentFromIntervals,
  totalWatchedSeconds,
  type WatchedInterval,
} from "../lib/watchIntervals";

const DURATION = 600; // 10분 영상

function simulateServerUpdate(
  stored: WatchedInterval[],
  wasCompleted: boolean,
  incoming: WatchedInterval[],
  durationSec: number,
  clientProgressPercent?: number
): { merged: WatchedInterval[]; percent: number; is_completed: boolean; path: "interval" | "legacy" } {
  const useIntervalPath = incoming.length > 0;
  if (!useIntervalPath) {
    const pct = clientProgressPercent ?? 0;
    return {
      merged: stored,
      percent: pct,
      is_completed: wasCompleted || Boolean(pct >= COMPLETE_THRESHOLD_PERCENT),
      path: "legacy",
    };
  }
  const merged = mergeIntervals([...stored, ...incoming]);
  const percent = percentFromIntervals(merged, durationSec);
  return {
    merged,
    percent,
    is_completed: wasCompleted || percent >= COMPLETE_THRESHOLD_PERCENT,
    path: "interval",
  };
}

/** 재생 tick 시뮬: prev→current 구간을 intervals에 추가 */
function watch(from: number, to: number, existing: WatchedInterval[]): WatchedInterval[] {
  if (to <= from) return existing;
  return mergeIntervals([...existing, [from, to]]);
}

/** seek 시뮬: 구간 끊김, 새 위치에서 재생 없음 */
function skip(existing: WatchedInterval[]): WatchedInterval[] {
  return existing;
}

type Result = { ok: boolean; detail: string };

const results: { name: string; result: Result }[] = [];

function assert(name: string, cond: boolean, detail: string) {
  results.push({ name, result: { ok: cond, detail } });
  const mark = cond ? "PASS" : "FAIL";
  console.log(`[${mark}] ${name}: ${detail}`);
}

// 시나리오 1: 0~50% 정상 시청
{
  let intervals = watch(0, 300, []);
  const pct = percentFromIntervals(intervals, DURATION);
  assert("시나리오 1", Math.abs(pct - 50) < 0.01, `0~50% 시청 → ${pct}% (기대 50%)`);
}

// 시나리오 2: 50%까지 본 뒤 50→80% 스킵
{
  let intervals = watch(0, 300, []);
  intervals = skip(intervals); // 480으로 점프, 재생 없음
  const pct = percentFromIntervals(intervals, DURATION);
  assert("시나리오 2", Math.abs(pct - 50) < 0.01, `스킵 후 ${pct}% 유지 (기대 50%)`);
}

// 시나리오 3: 0~50% 본 뒤 60~80% 시청
{
  let intervals = watch(0, 300, []);
  intervals = watch(360, 480, intervals);
  const pct = percentFromIntervals(intervals, DURATION);
  assert("시나리오 3", Math.abs(pct - 70) < 0.01, `0~50% + 60~80% → ${pct}% (기대 70%)`);
}

// 시나리오 4: 0~100% 두 번 시청 (중복 없음)
{
  let intervals = watch(0, 600, []);
  intervals = watch(0, 600, intervals);
  const total = totalWatchedSeconds(intervals);
  assert("시나리오 4", total === 600, `반복 시청 total=${total}s (기대 600s, 중복 없음)`);
}

// 시나리오 5: 배속 2x — 영상 시간 기준 0~300초 재생
{
  const intervals = watch(0, 300, []);
  const pct = percentFromIntervals(intervals, DURATION);
  assert("시나리오 5", Math.abs(pct - 50) < 0.01, `2x 배속 0~300s → ${pct}% (기대 50%, wall-clock 무관)`);
}

// 시나리오 6: 여러 날 — 서버 stored + incoming merge
{
  const day1Stored: WatchedInterval[] = [[0, 200]];
  const day2Incoming: WatchedInterval[] = [[200, 400]];
  const { merged, percent } = simulateServerUpdate(day1Stored, false, day2Incoming, DURATION);
  assert(
    "시나리오 6",
    merged.length === 1 && merged[0][0] === 0 && merged[0][1] === 400 && Math.abs(percent - 66.67) < 0.1,
    `누적 merge → ${JSON.stringify(merged)}, ${percent}%`
  );
}

// 시나리오 7: is_completed=true 후 스킵 재시청 — 완료 유지
{
  const stored: WatchedInterval[] = [[0, 570]]; // 95%
  const wasCompleted = true;
  // 스킵만 하고 새 구간 없음 → incoming empty would use legacy, but with intervals we send merged
  const incoming: WatchedInterval[] = []; // no new watch
  const legacy = simulateServerUpdate(stored, wasCompleted, incoming, DURATION, 30);
  assert(
    "시나리오 7a (legacy 빈 intervals)",
    legacy.is_completed === true,
    `legacy path: is_completed=${legacy.is_completed} (기대 true)`
  );

  // interval path: 완료 후 스킵만 — 클라이언트가 기존 intervals를 그대로 전송
  const skipOnly = simulateServerUpdate(stored, wasCompleted, stored, DURATION);
  assert(
    "시나리오 7b (interval, 스킵만)",
    skipOnly.is_completed === true && skipOnly.percent >= COMPLETE_THRESHOLD_PERCENT,
    `percent=${skipOnly.percent}%, is_completed=${skipOnly.is_completed} (스킵 후에도 완료·진도 유지)`
  );

  // interval path: 완료 후 처음부터 일부만 재시청 — merge 후에도 95% 이상·완료 유지
  const incomingSmall: WatchedInterval[] = [[0, 60]];
  const rewatch = simulateServerUpdate(stored, wasCompleted, incomingSmall, DURATION);
  assert(
    "시나리오 7c (interval, 일부 재시청)",
    rewatch.is_completed === true && rewatch.percent >= COMPLETE_THRESHOLD_PERCENT,
    `percent=${rewatch.percent}%, is_completed=${rewatch.is_completed} (재시청 merge 후에도 완료 유지)`
  );

  // legacy 완료 + interval 없음 + 낮은 progress_percent — OR로 완료 유지
  const legacyCompleted = simulateServerUpdate([], true, [], DURATION, 10);
  assert(
    "시나리오 7d (legacy 완료 OR)",
    legacyCompleted.is_completed === true,
    `legacy is_completed=${legacyCompleted.is_completed} (기존 완료면 percent 낮아도 유지)`
  );
}

// 시나리오 8: watched_intervals=[] legacy path
{
  const stored: WatchedInterval[] = [];
  const incoming: WatchedInterval[] = [];
  const res = simulateServerUpdate(stored, false, incoming, DURATION, 75);
  assert(
    "시나리오 8",
    res.path === "legacy" && res.percent === 75,
    `legacy path progress=${res.percent}% (클라이언트 progress_percent 그대로 반영)`
  );
}

// normalizeIntervals edge cases
{
  const raw = [[0, 100], ["bad"], [200, 150], null, [300, 400]];
  const norm = normalizeIntervals(raw);
  assert(
    "normalizeIntervals",
    norm.length === 2 && norm[0][0] === 0 && norm[1][0] === 300,
    `유효 구간만 추출: ${JSON.stringify(norm)}`
  );
}

const failed = results.filter((r) => !r.result.ok);
console.log("\n--- 요약 ---");
console.log(`총 ${results.length}개, PASS ${results.length - failed.length}, FAIL ${failed.length}`);
if (failed.length > 0) {
  process.exit(1);
}

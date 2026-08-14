/**
 * lastPlayingPositionRef 기반 finalize vs getCurrentTime() finalize 비교 시뮬레이션
 * 실행: npx tsx scripts/test-seek-segment.ts
 */
import { mergeIntervals, percentFromIntervals, type WatchedInterval } from "../lib/watchIntervals";

const DURATION = 1762.676;

function simulateFinalize(
  label: string,
  endSec: number,
  segmentStart: number,
  segmentOpen: boolean,
  existing: WatchedInterval[]
): WatchedInterval[] {
  if (!segmentOpen) return existing;
  if (endSec <= segmentStart + 0.2) return existing;
  return mergeIntervals([...existing, [segmentStart, endSec]]);
}

function simulateSeekScenario(useLastPlayingRef: boolean) {
  let intervals: WatchedInterval[] = [];
  let segmentStart = 0;
  let segmentOpen = false;
  let lastPlayingPosition = 0;
  let lastCurrent = 0;

  const openSegment = (s: number) => {
    segmentStart = s;
    segmentOpen = true;
  };
  const finalize = (endSec: number) => {
    intervals = simulateFinalize("", endSec, segmentStart, segmentOpen, intervals);
    segmentOpen = false;
  };

  // 1) 재생 시작
  openSegment(0);
  // 2) 0~5초 재생 (tick)
  lastCurrent = 5;
  lastPlayingPosition = 5;
  // 3) seek → BUFFERING (onStateChange)
  const seekTarget = 1700;
  const bufferingTime = seekTarget; // getCurrentTime() already at seek target
  if (useLastPlayingRef) {
    finalize(lastPlayingPosition); // 5
  } else {
    finalize(bufferingTime); // 1700 — bug
  }
  // 4) 재생 재개 tick: detectSeekBreak
  const prev = lastCurrent;
  const current = seekTarget;
  lastCurrent = current;
  lastPlayingPosition = current;
  if (Math.abs(current - prev) > 1.5) {
    finalize(prev);
    openSegment(current);
  }
  // 5) 끝까지 재생
  lastPlayingPosition = DURATION;
  finalize(DURATION);

  return mergeIntervals(intervals);
}

const buggy = simulateSeekScenario(false);
const fixed = simulateSeekScenario(true);
const sequential = (() => {
  let intervals: WatchedInterval[] = [];
  let segmentStart = 0;
  let segmentOpen = false;
  const openSegment = (s: number) => {
    segmentStart = s;
    segmentOpen = true;
  };
  const finalize = (endSec: number) => {
    intervals = simulateFinalize("", endSec, segmentStart, segmentOpen, intervals);
    segmentOpen = false;
  };
  openSegment(0);
  finalize(DURATION);
  return mergeIntervals(intervals);
})();

const pct = (iv: WatchedInterval[]) => percentFromIntervals(iv, DURATION);

console.log("=== seek 후 끝까지 (버그: getCurrentTime on buffering) ===");
console.log("intervals:", JSON.stringify(buggy));
console.log("percent:", pct(buggy).toFixed(2) + "%");

console.log("\n=== seek 후 끝까지 (수정: lastPlayingPositionRef) ===");
console.log("intervals:", JSON.stringify(fixed));
console.log("percent:", pct(fixed).toFixed(2) + "%");

console.log("\n=== 처음부터 끝까지 (회귀) ===");
console.log("intervals:", JSON.stringify(sequential));
console.log("percent:", pct(sequential).toFixed(2) + "%");

const ok =
  pct(buggy) > 90 &&
  pct(fixed) < 20 &&
  pct(fixed) > 1 &&
  pct(sequential) >= 99;

console.log(ok ? "\nPASS" : "\nFAIL");
process.exit(ok ? 0 : 1);

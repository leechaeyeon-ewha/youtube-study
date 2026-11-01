/**
 * 시청 페이지 탭 이탈/복귀 시 재생 위치 sessionStorage 보조 저장.
 */

const KEY_PREFIX = "youtube_study_watch_pos:";
const MAX_AGE_MS = 6 * 60 * 60 * 1000;

function storageKey(assignmentId: string): string {
  return `${KEY_PREFIX}${assignmentId}`;
}

export function saveWatchSessionPosition(assignmentId: string, currentTimeSec: number): void {
  if (typeof window === "undefined" || !assignmentId?.trim()) return;
  if (!Number.isFinite(currentTimeSec) || currentTimeSec < 0) return;
  try {
    sessionStorage.setItem(
      storageKey(assignmentId),
      JSON.stringify({ t: currentTimeSec, at: Date.now() })
    );
  } catch {
    // ignore
  }
}

export function readWatchSessionPosition(assignmentId: string): number | null {
  if (typeof window === "undefined" || !assignmentId?.trim()) return null;
  try {
    const raw = sessionStorage.getItem(storageKey(assignmentId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { t?: number; at?: number };
    const at = Number(parsed.at);
    if (!Number.isFinite(at) || Date.now() - at > MAX_AGE_MS) {
      sessionStorage.removeItem(storageKey(assignmentId));
      return null;
    }
    const t = Number(parsed.t);
    return Number.isFinite(t) && t >= 0 ? t : null;
  } catch {
    return null;
  }
}

/** DB last_position과 sessionStorage 중 더 큰 값(초) */
export function resolveWatchStartPosition(
  assignmentId: string,
  dbLastPosition: number
): number {
  const db = Number.isFinite(dbLastPosition) && dbLastPosition >= 0 ? dbLastPosition : 0;
  const session = readWatchSessionPosition(assignmentId);
  if (session == null) return db;
  return Math.max(db, session);
}

export function clearWatchSessionPosition(assignmentId: string): void {
  if (typeof window === "undefined" || !assignmentId?.trim()) return;
  try {
    sessionStorage.removeItem(storageKey(assignmentId));
  } catch {
    // ignore
  }
}

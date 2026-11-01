import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import {
  COMPLETE_THRESHOLD_PERCENT,
  mergeIntervals,
  normalizeIntervals,
  percentFromIntervals,
  type WatchedInterval,
} from "@/lib/watchIntervals";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

const TOUCH_THROTTLE_MS = 30_000;

function serverNow(): string {
  return new Date().toISOString();
}

function resolveNextLastPosition(
  lastPosition: number | undefined,
  storedLastPosition: unknown
): number {
  if (lastPosition != null) return Number(lastPosition);
  return Number(storedLastPosition ?? 0);
}

function shouldThrottleTouch(lastWatchedAt: string | null | undefined): boolean {
  if (!lastWatchedAt) return false;
  const t = Date.parse(lastWatchedAt);
  if (!Number.isFinite(t)) return false;
  return Date.now() - t < TOUCH_THROTTLE_MS;
}

/**
 * 시청 진도 저장. assignment가 없으면 404, 있으면 먼저 null 필드 정규화 후 업데이트(upsert 스타일).
 * watched_intervals가 비어 있지 않으면 서버에서 병합·재계산(클라이언트 progress_percent 미신뢰).
 */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  }
  const authUserId = user.id;

  let body: {
    assignmentId?: string;
    progress_percent?: number;
    is_completed?: boolean;
    last_position?: number;
    last_watched_at?: string;
    watched_intervals?: unknown;
    duration_sec?: number;
    isReviewMode?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const assignmentId = body?.assignmentId;
  if (!assignmentId || typeof assignmentId !== "string") {
    return NextResponse.json({ error: "assignmentId가 필요합니다." }, { status: 400 });
  }

  async function touchWatchMeta(
    lastPosition: number
  ): Promise<{ ok: true; rows: { id: string }[] } | { ok: false; error: string }> {
    const touchPayload: Record<string, unknown> = {
      last_watched_at: serverNow(),
      last_position: lastPosition,
    };
    const { data, error } = await supabase
      .from("assignments")
      .update(touchPayload)
      .eq("id", assignmentId as string)
      .eq("user_id", authUserId)
      .select("id");

    if (error) return { ok: false, error: error.message };
    const rows = (data ?? []) as { id: string }[];
    if (rows.length === 0) {
      return { ok: false, error: "해당 과제를 찾을 수 없습니다." };
    }
    return { ok: true, rows };
  }

  const progressPercent = body?.progress_percent;
  const lastPosition = body?.last_position;
  const incomingIntervals = normalizeIntervals(body?.watched_intervals);
  const durationSec = body?.duration_sec != null ? Number(body.duration_sec) : NaN;
  const isReviewMode = body?.isReviewMode === true;

  const useIntervalPath = incomingIntervals.length > 0;

  if (!useIntervalPath) {
    if (
      progressPercent == null ||
      !Number.isFinite(Number(progressPercent)) ||
      Number(progressPercent) < 0 ||
      Number(progressPercent) > 100
    ) {
      return NextResponse.json({ error: "progress_percent가 필요합니다." }, { status: 400 });
    }
  } else {
    if (!Number.isFinite(durationSec) || durationSec <= 0) {
      return NextResponse.json({ error: "duration_sec가 올바르지 않습니다." }, { status: 400 });
    }
  }

  if (lastPosition != null && (!Number.isFinite(Number(lastPosition)) || Number(lastPosition) < 0)) {
    return NextResponse.json({ error: "last_position이 올바르지 않습니다." }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await supabase
    .from("assignments")
    .select("id, progress_percent, last_position, is_completed, watched_intervals, last_watched_at")
    .eq("id", assignmentId as string)
    .eq("user_id", authUserId)
    .single();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "해당 과제를 찾을 수 없습니다." }, { status: 404 });
  }

  const needNormalize =
    row.progress_percent == null || row.last_position == null || row.is_completed == null;
  if (needNormalize) {
    await supabase
      .from("assignments")
      .update({
        progress_percent: row.progress_percent ?? 0,
        last_position: row.last_position ?? 0,
        is_completed: row.is_completed ?? false,
      })
      .eq("id", assignmentId as string)
      .eq("user_id", authUserId);
  }

  const wasCompleted = row.is_completed === true;

  let updatePayload: Record<string, unknown>;

  if (useIntervalPath) {
    const stored = normalizeIntervals(row.watched_intervals);
    const merged: WatchedInterval[] = mergeIntervals([...stored, ...incomingIntervals]);
    const calculatedPercent = percentFromIntervals(merged, durationSec);
    const storedPercent = Number(row.progress_percent ?? 0);
    const newCompleted =
      wasCompleted || calculatedPercent >= COMPLETE_THRESHOLD_PERCENT;
    const progress_percent = wasCompleted
      ? Math.max(storedPercent, calculatedPercent)
      : calculatedPercent;

    const nextLastPosition = resolveNextLastPosition(lastPosition, row.last_position);

    if (
      JSON.stringify(merged) === JSON.stringify(stored) &&
      Math.abs(progress_percent - storedPercent) < 0.01 &&
      newCompleted === wasCompleted &&
      Math.abs(nextLastPosition - Number(row.last_position ?? 0)) < 1 &&
      !isReviewMode
    ) {
      if (!shouldThrottleTouch(row.last_watched_at as string | null)) {
        const touch = await touchWatchMeta(nextLastPosition);
        if (!touch.ok) {
          return NextResponse.json({ error: touch.error }, { status: 404 });
        }
        return NextResponse.json({ ok: true, skipped: true, last_watched_at_updated: true });
      }
      return NextResponse.json({ ok: true, skipped: true });
    }

    updatePayload = {
      watched_intervals: merged,
      progress_percent: Math.min(100, progress_percent),
      is_completed: newCompleted,
      last_position: nextLastPosition,
      last_watched_at: serverNow(),
    };
  } else {
    const nextProgress = Number(progressPercent);
    const storedPercent = Number(row.progress_percent ?? 0);
    const finalProgress = wasCompleted
      ? Math.max(storedPercent, nextProgress)
      : nextProgress;
    const nextCompleted =
      wasCompleted || finalProgress >= COMPLETE_THRESHOLD_PERCENT;
    const nextLastPosition = resolveNextLastPosition(lastPosition, row.last_position);

    if (
      Math.abs(finalProgress - storedPercent) < 0.01 &&
      nextCompleted === wasCompleted &&
      Math.abs(nextLastPosition - Number(row.last_position ?? 0)) < 1 &&
      !isReviewMode
    ) {
      if (!shouldThrottleTouch(row.last_watched_at as string | null)) {
        const touch = await touchWatchMeta(nextLastPosition);
        if (!touch.ok) {
          return NextResponse.json({ error: touch.error }, { status: 404 });
        }
        return NextResponse.json({ ok: true, skipped: true, last_watched_at_updated: true });
      }
      return NextResponse.json({ ok: true, skipped: true });
    }

    updatePayload = {
      progress_percent: Math.min(100, finalProgress),
      is_completed: nextCompleted,
      last_position: nextLastPosition,
      last_watched_at: serverNow(),
    };
  }

  const nextProgressPercent = Number(updatePayload.progress_percent);
  const fallbackLastPosition = Number(updatePayload.last_position);

  async function runProgressUpdate(payload: Record<string, unknown>, ltePercent: number) {
    return supabase
      .from("assignments")
      .update(payload)
      .eq("id", assignmentId as string)
      .eq("user_id", authUserId)
      .lte("progress_percent", ltePercent)
      .select("id");
  }

  let { data: updatedRows, error: updateErr } = await runProgressUpdate(
    updatePayload,
    nextProgressPercent
  );

  if (
    updateErr &&
    useIntervalPath &&
    (updateErr.message?.includes("watched_intervals") || updateErr.message?.includes("does not exist"))
  ) {
    const legacyPayload = { ...updatePayload };
    delete legacyPayload.watched_intervals;
    if (progressPercent != null && Number.isFinite(Number(progressPercent))) {
      legacyPayload.progress_percent = Number(progressPercent);
    }
    const retryProgressPercent = Number(legacyPayload.progress_percent);
    const retry = await runProgressUpdate(legacyPayload, retryProgressPercent);
    updatedRows = retry.data;
    updateErr = retry.error;
  }

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  const rowCount = (updatedRows ?? []).length;
  if (rowCount === 0) {
    const touch = await touchWatchMeta(fallbackLastPosition);
    if (!touch.ok) {
      return NextResponse.json({ error: touch.error }, { status: 404 });
    }
    if (process.env.NODE_ENV === "development") {
      console.warn("[progress] progress_unchanged: lte guard blocked full update", {
        assignmentId,
        stored: row.progress_percent,
        attempted: nextProgressPercent,
      });
    }
    return NextResponse.json({
      ok: true,
      progress_unchanged: true,
      reason: "lte_guard",
      last_watched_at_updated: true,
    });
  }

  return NextResponse.json({ ok: true });
}

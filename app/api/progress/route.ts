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

  const progressPercent = body?.progress_percent;
  const isCompleted = body?.is_completed;
  const lastPosition = body?.last_position;
  const lastWatchedAt = body?.last_watched_at;
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
    .select("id, progress_percent, last_position, is_completed, watched_intervals")
    .eq("id", assignmentId as string)
    .eq("user_id", user.id)
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
      .eq("user_id", user.id);
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

    const nextLastPosition =
      lastPosition != null ? Number(lastPosition) : (row.last_position ?? 0);

    if (
      JSON.stringify(merged) === JSON.stringify(stored) &&
      Math.abs(progress_percent - storedPercent) < 0.01 &&
      newCompleted === wasCompleted &&
      Math.abs(nextLastPosition - Number(row.last_position ?? 0)) < 1 &&
      !isReviewMode
    ) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    updatePayload = {
      watched_intervals: merged,
      progress_percent: Math.min(100, progress_percent),
      is_completed: newCompleted,
      last_position: nextLastPosition,
      last_watched_at: lastWatchedAt ?? new Date().toISOString(),
    };
  } else {
    const nextProgress = Number(progressPercent);
    const storedPercent = Number(row.progress_percent ?? 0);
    const nextCompleted = wasCompleted || Boolean(isCompleted);
    const finalProgress = wasCompleted
      ? Math.max(storedPercent, nextProgress)
      : nextProgress;
    const nextLastPosition =
      lastPosition != null ? Number(lastPosition) : (row.last_position ?? 0);

    if (
      Math.abs(finalProgress - storedPercent) < 0.01 &&
      nextCompleted === wasCompleted &&
      Math.abs(nextLastPosition - Number(row.last_position ?? 0)) < 1 &&
      !isReviewMode
    ) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    updatePayload = {
      progress_percent: Math.min(100, finalProgress),
      is_completed: nextCompleted,
      last_position: nextLastPosition,
      last_watched_at: lastWatchedAt ?? new Date().toISOString(),
    };
  }

  let { error: updateErr } = await supabase
    .from("assignments")
    .update(updatePayload)
    .eq("id", assignmentId as string)
    .eq("user_id", user.id);

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
    const { error: retryErr } = await supabase
      .from("assignments")
      .update(legacyPayload)
      .eq("id", assignmentId as string)
      .eq("user_id", user.id);
    updateErr = retryErr;
  }

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

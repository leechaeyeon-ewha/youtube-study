import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * 시청 진도 저장. assignment가 없으면 404, 있으면 먼저 null 필드 정규화 후 업데이트(upsert 스타일).
 * 기존 데이터 유무와 관계없이 항상 최신 상태 유지.
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

  let body: { assignmentId?: string; progress_percent?: number; is_completed?: boolean; last_position?: number; last_watched_at?: string; watched_seconds?: number };
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
  const watchedSeconds = body?.watched_seconds;
  if (
    progressPercent == null ||
    !Number.isFinite(Number(progressPercent)) ||
    Number(progressPercent) < 0 ||
    Number(progressPercent) > 100
  ) {
    return NextResponse.json({ error: "progress_percent가 필요합니다." }, { status: 400 });
  }
  if (lastPosition != null && (!Number.isFinite(Number(lastPosition)) || Number(lastPosition) < 0)) {
    return NextResponse.json({ error: "last_position이 올바르지 않습니다." }, { status: 400 });
  }
  if (watchedSeconds != null && (!Number.isFinite(Number(watchedSeconds)) || Number(watchedSeconds) < 0)) {
    return NextResponse.json({ error: "watched_seconds가 올바르지 않습니다." }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await supabase
    .from("assignments")
    .select("id, progress_percent, last_position, is_completed")
    .eq("id", assignmentId as string)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "해당 과제를 찾을 수 없습니다." }, { status: 404 });
  }

  // null 필드가 있으면 먼저 정규화(upsert 전제)
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

  const updatePayload: Record<string, unknown> = {
    progress_percent: Number(progressPercent),
    is_completed: Boolean(isCompleted),
    last_position: lastPosition != null ? Number(lastPosition) : (row.last_position ?? 0),
    last_watched_at: lastWatchedAt ?? new Date().toISOString(),
  };
  if (watchedSeconds != null && Number.isFinite(watchedSeconds)) {
    updatePayload.watched_seconds = Number(watchedSeconds);
  }

  const { error: updateErr } = await supabase
    .from("assignments")
    .update(updatePayload)
    .eq("id", assignmentId as string)
    .eq("user_id", user.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

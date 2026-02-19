import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * 학생이 시청 페이지에 들어왔을 때, 해당 assignment의 진도/위치 필드가 null이면
 * 즉시 기본값으로 정규화해 기존 데이터 정합성을 복구합니다.
 * started_at은 건드리지 않아 '미시청' 상태를 유지합니다.
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

  let body: { assignmentId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const assignmentId = body?.assignmentId;
  if (!assignmentId || typeof assignmentId !== "string") {
    return NextResponse.json({ error: "assignmentId가 필요합니다." }, { status: 400 });
  }

  const { data: row, error: fetchErr } = await supabase
    .from("assignments")
    .select("id, progress_percent, last_position, is_completed, last_watched_at, started_at")
    .eq("id", assignmentId as string)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "해당 과제를 찾을 수 없습니다." }, { status: 404 });
  }

  const needFix =
    row.progress_percent == null ||
    row.last_position == null ||
    row.is_completed == null;

  if (!needFix) {
    return NextResponse.json({ ok: true, normalized: false });
  }

  const { error: updateErr } = await supabase
    .from("assignments")
    .update({
      progress_percent: row.progress_percent ?? 0,
      last_position: row.last_position ?? 0,
      is_completed: row.is_completed ?? false,
      // last_watched_at, started_at은 그대로 두어 미시청 상태 유지
    })
    .eq("id", assignmentId as string)
    .eq("user_id", user.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, normalized: true });
}

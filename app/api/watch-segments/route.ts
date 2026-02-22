import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/** 학생: 본인 배정에 한해 시청 구간(몇 분~몇 분) 저장. 스킵 허용 시 플레이어에서 호출 */
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

  let body: { assignmentId?: string; segments?: { start_sec: number; end_sec: number }[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 형식이 올바르지 않습니다." }, { status: 400 });
  }
  const assignmentId = body?.assignmentId;
  if (!assignmentId || typeof assignmentId !== "string") {
    return NextResponse.json({ error: "assignmentId가 필요합니다." }, { status: 400 });
  }
  const segments = body?.segments;
  if (!Array.isArray(segments) || segments.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { data: row, error: fetchErr } = await supabase
    .from("assignments")
    .select("id")
    .eq("id", assignmentId)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !row) {
    return NextResponse.json({ error: "해당 과제를 찾을 수 없습니다." }, { status: 404 });
  }

  const rows = segments
    .filter(
      (s): s is { start_sec: number; end_sec: number } =>
        typeof s?.start_sec === "number" &&
        typeof s?.end_sec === "number" &&
        Number.isFinite(s.start_sec) &&
        Number.isFinite(s.end_sec) &&
        s.start_sec >= 0 &&
        s.end_sec > s.start_sec
    )
    .map((s) => ({
      assignment_id: assignmentId,
      start_sec: s.start_sec,
      end_sec: s.end_sec,
    }));

  if (rows.length === 0) {
    return NextResponse.json({ ok: true });
  }

  const { error: insertErr } = await supabase.from("watch_segments").insert(rows);

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

/** 진도 1% 이상이 된 시점에 한 번만 assignments.started_at 기록 (이미 있으면 덮어쓰지 않음). 동시에 watch_starts 테이블에 학습 시작 시각 1건 INSERT (관리자 시청 상세에서 목록 표시용). */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const {
    data: { user },
  } = await supabase.auth.getUser(token);
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

  const { data: assignment, error: fetchErr } = await supabase
    .from("assignments")
    .select("id, user_id, started_at")
    .eq("id", assignmentId)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !assignment) {
    return NextResponse.json({ error: "해당 과제를 찾을 수 없습니다." }, { status: 403 });
  }

  if (assignment.started_at != null && assignment.started_at !== "") {
    return NextResponse.json({ ok: true, alreadyRecorded: true });
  }

  const now = new Date().toISOString();
  const { error: updateErr } = await supabase
    .from("assignments")
    .update({ started_at: now })
    .eq("id", assignmentId as string)
    .eq("user_id", user.id)
    .is("started_at", null);

  if (updateErr) {
    const msg = updateErr.message ?? "";
    const noColumn = msg.includes("started_at") || updateErr.code === "42703";
    return NextResponse.json(
      {
        error: noColumn
          ? "started_at 컬럼이 없습니다. Supabase에서 supabase/migration_assignments_started_at.sql 을 실행해 주세요."
          : "기록에 실패했습니다.",
      },
      { status: noColumn ? 503 : 500 }
    );
  }

  // 학습 시작 시각 목록(관리자 시청 상세용): watch_starts에 1건 INSERT. service role로 삽입해 RLS 영향 없이 기록.
  if (supabaseServiceKey) {
    const serviceSupabase = createClient(supabaseUrl, supabaseServiceKey);
    await serviceSupabase
      .from("watch_starts")
      .insert({ assignment_id: assignmentId, started_at: now });
  }

  return NextResponse.json({ ok: true });
}

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** 학생이 영상 시청 페이지에 들어와 시청을 시작한 시각 기록 (한 번 로드할 때마다 1건) */
export async function POST(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user } } = await supabase.auth.getUser(token);
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

  const anon = createClient(supabaseUrl, supabaseAnonKey);
  const { data: assignment, error: fetchErr } = await anon
    .from("assignments")
    .select("id, user_id")
    .eq("id", assignmentId)
    .eq("user_id", user.id)
    .single();

  if (fetchErr || !assignment) {
    return NextResponse.json({ error: "해당 과제를 찾을 수 없습니다." }, { status: 403 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }
  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { error: insertErr } = await admin.from("watch_starts").insert({
    assignment_id: assignmentId,
  });

  if (insertErr) {
    const msg = insertErr.message ?? "";
    const tableMissing = msg.includes("watch_starts") || msg.includes("does not exist") || insertErr.code === "42P01";
    return NextResponse.json(
      {
        error: tableMissing
          ? "watch_starts 테이블이 없습니다. Supabase 대시보드 → SQL Editor에서 supabase/migration_watch_starts.sql 내용을 실행해 주세요."
          : "기록에 실패했습니다.",
      },
      { status: tableMissing ? 503 : 500 }
    );
  }
  return NextResponse.json({ ok: true });
}

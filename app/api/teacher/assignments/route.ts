import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function requireTeacher(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) return null;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "teacher" ? user : null;
}

/** 강사 전용: 본인 담당 학생에게만 영상 배정 */
export async function POST(req: Request) {
  const teacher = await requireTeacher(req);
  if (!teacher) {
    return NextResponse.json({ error: "강사만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "서버 설정이 없습니다." },
      { status: 500 }
    );
  }
  const body = await req.json().catch(() => ({}));
  const studentId = typeof body.student_id === "string" ? body.student_id.trim() : "";
  const videoId = typeof body.video_id === "string" ? body.video_id.trim() : "";
  if (!studentId || !videoId) {
    return NextResponse.json({ error: "student_id와 video_id를 지정해 주세요." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: student } = await supabase
    .from("profiles")
    .select("id, teacher_id")
    .eq("id", studentId)
    .eq("role", "student")
    .single();

  if (!student || (student as { teacher_id?: string | null }).teacher_id !== teacher.id) {
    return NextResponse.json({ error: "해당 학생에게 배정할 권한이 없습니다." }, { status: 403 });
  }

  const { data: inserted, error } = await supabase
    .from("assignments")
    .insert({
      user_id: studentId,
      video_id: videoId,
      is_completed: false,
      progress_percent: 0,
      last_position: 0,
      is_visible: true,
      is_weekly_assignment: false,
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === "23505") {
      return NextResponse.json({ error: "이미 해당 학생에게 배정된 영상입니다." }, { status: 400 });
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, id: inserted?.id });
}

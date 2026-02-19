import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** 강사 본인에게 할당된 학생만 반환 (role=teacher, teacher_id=본인 id 인 학생) */
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

/** 강사 전용: 본인 담당 학생 목록만 조회 */
export async function GET(req: Request) {
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
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const baseSelect = "id, full_name, email, report_token, is_report_enabled, parent_phone, class_id, grade, teacher_id";
  let data: Record<string, unknown>[] | null = null;

  const { data: withStatus, error: errWith } = await supabase
    .from("profiles")
    .select(`${baseSelect}, enrollment_status`)
    .eq("role", "student")
    .eq("teacher_id", teacher.id)
    .order("full_name");

  if (errWith) {
    const baseWithoutTeacher = "id, full_name, email, report_token, is_report_enabled, parent_phone, class_id, grade";
    const { data: withoutStatus, error: errWithout } = await supabase
      .from("profiles")
      .select(`${baseWithoutTeacher}, enrollment_status`)
      .eq("role", "student")
      .eq("teacher_id", teacher.id)
      .order("full_name");

    if (errWithout) {
      const { data: minimal, error: errMinimal } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "student")
        .eq("teacher_id", teacher.id)
        .order("full_name");
      if (errMinimal) {
        return NextResponse.json({ error: errMinimal.message }, { status: 500 });
      }
      data = (minimal ?? []).map((row) => ({
        ...row,
        report_token: null,
        is_report_enabled: false,
        parent_phone: null,
        class_id: null,
        grade: null,
        enrollment_status: "enrolled",
        teacher_id: teacher.id,
      }));
    } else {
      data = (withoutStatus ?? []).map((row) => ({
        ...row,
        grade: (row as { grade?: string | null }).grade ?? null,
        enrollment_status: (row as { enrollment_status?: string }).enrollment_status ?? "enrolled",
        teacher_id: teacher.id,
      }));
    }
  } else {
    data = (withStatus ?? []).map((row) => ({
      ...row,
      teacher_id: (row as { teacher_id?: string | null }).teacher_id ?? teacher.id,
    }));
  }

  return NextResponse.json(data ?? []);
}

/** 강사 전용: 본인 담당 학생의 정보만 수정 (class_id, grade, is_report_enabled). 퇴원/삭제 불가. */
export async function PATCH(req: Request) {
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
  if (!studentId) {
    return NextResponse.json({ error: "student_id를 지정해 주세요." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: student } = await supabase
    .from("profiles")
    .select("id, teacher_id")
    .eq("id", studentId)
    .eq("role", "student")
    .single();

  if (!student || (student as { teacher_id?: string | null }).teacher_id !== teacher.id) {
    return NextResponse.json({ error: "해당 학생을 수정할 권한이 없습니다." }, { status: 403 });
  }

  const updates: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "class_id")) {
    updates.class_id = body.class_id === null || body.class_id === "" ? null : body.class_id;
  }
  if (Object.prototype.hasOwnProperty.call(body, "grade")) {
    updates.grade = body.grade === null || body.grade === "" ? null : body.grade;
  }
  if (Object.prototype.hasOwnProperty.call(body, "is_report_enabled")) {
    updates.is_report_enabled = !!body.is_report_enabled;
  }
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "수정할 필드를 지정해 주세요." }, { status: 400 });
  }

  const { error: updateError } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", studentId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }
  return NextResponse.json({ success: true });
}

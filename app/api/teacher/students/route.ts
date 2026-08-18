import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { fetchTeacherStudents } from "@/lib/studentsListFetch";
import { requireTeacher } from "@/lib/auth/requireRole";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/** 강사 본인에게 할당된 학생만 반환 (role=teacher, teacher_id=본인 id 인 학생) */

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

  const { data: fetched, error: fetchError } = await fetchTeacherStudents(supabase, teacher.id);
  if (fetchError) {
    return NextResponse.json({ error: fetchError }, { status: 500 });
  }

  const isMinimal = fetched.length > 0 && !("report_token" in fetched[0]);
  const isWithoutTeacher = !isMinimal && fetched.length > 0 && !("teacher_id" in fetched[0]);

  let data: Record<string, unknown>[];
  if (isMinimal) {
    data = fetched.map((row) => ({
      ...row,
      report_token: null,
      is_report_enabled: false,
      parent_phone: null,
      class_id: null,
      grade: null,
      enrollment_status: "enrolled",
      teacher_id: teacher.id,
    }));
  } else if (isWithoutTeacher) {
    data = fetched.map((row) => ({
      ...row,
      grade: (row as { grade?: string | null }).grade ?? null,
      enrollment_status: (row as { enrollment_status?: string }).enrollment_status ?? "enrolled",
      teacher_id: teacher.id,
    }));
  } else {
    data = fetched.map((row) => ({
      ...row,
      teacher_id: (row as { teacher_id?: string | null }).teacher_id ?? teacher.id,
    }));
  }

  return NextResponse.json(data);
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

/** 강사 전용: 담당 학생 등록 (자동으로 teacher_id = 본인 설정). 퇴원/삭제는 관리자만. */
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

  let body: { full_name?: string; password?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";

  if (!fullName) {
    return NextResponse.json({ error: "이름을 입력해 주세요." }, { status: 400 });
  }
  if (!password || password.length < 4) {
    return NextResponse.json({ error: "비밀번호는 4자 이상 입력해 주세요." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const email = `student_${Date.now()}_${Math.random().toString(36).slice(2, 10)}@academy.local`;

  const { data: userData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: "student" },
  });

  if (createError) {
    return NextResponse.json(
      { error: createError.message },
      { status: 400 }
    );
  }

  if (!userData.user) {
    return NextResponse.json({ error: "사용자 생성에 실패했습니다." }, { status: 500 });
  }

  const profileRow = {
    id: userData.user.id,
    role: "student" as const,
    full_name: fullName,
    email,
    teacher_id: teacher.id,
  };

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userData.user.id)
    .maybeSingle();

  if (existing) {
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        role: "student",
        full_name: fullName,
        email,
        teacher_id: teacher.id,
      })
      .eq("id", userData.user.id);
    if (updateError) {
      return NextResponse.json(
        { error: `프로필 저장에 실패했습니다. ${updateError.message}`.trim() },
        { status: 500 }
      );
    }
  } else {
    const { error: insertError } = await supabase.from("profiles").insert(profileRow);
    if (insertError) {
      const msg = insertError.message ?? "";
      const hint = msg.includes("enrollment_status")
        ? " Supabase에서 migration_enrollment_status.sql을 실행해 주세요."
        : msg.includes("teacher_id")
          ? " Supabase에서 migration_teacher_role.sql을 실행해 주세요."
          : "";
      return NextResponse.json(
        { error: `프로필 저장에 실패했습니다.${hint}`.trim() },
        { status: 500 }
      );
    }
  }

  await supabase
    .from("profiles")
    .update({ enrollment_status: "enrolled" })
    .eq("id", userData.user.id);

  return NextResponse.json({
    id: userData.user.id,
    full_name: fullName,
    email,
  });
}

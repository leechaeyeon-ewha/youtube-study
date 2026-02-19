import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

async function requireAdmin(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) return null;
  const supabase = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user } } = await supabase.auth.getUser(token);
  if (!user) return null;
  const { data: profile } = await supabase.from("profiles").select("role").eq("id", user.id).single();
  return profile?.role === "admin" ? user : null;
}

/** 관리자 전용: 학생 목록 조회 (서비스 롤 사용, 탭 이동 후에도 목록 유지) */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "서버 설정이 없습니다." },
      { status: 500 }
    );
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // grade, teacher_id 컬럼은 선택적이므로 없을 때도 동작하도록
  const baseSelect = "id, full_name, email, report_token, is_report_enabled, parent_phone, class_id, grade, teacher_id";
  let data: Record<string, unknown>[] | null = null;

  const { data: withStatus, error: errWith } = await supabase
    .from("profiles")
    .select(`${baseSelect}, enrollment_status`)
    .eq("role", "student")
    .order("full_name");

  if (errWith) {
    const msg = errWith.message ?? "";
    const baseWithoutTeacher = "id, full_name, email, report_token, is_report_enabled, parent_phone, class_id, grade";
    const { data: withoutStatus, error: errWithout } = await supabase
      .from("profiles")
      .select(`${baseWithoutTeacher}, enrollment_status`)
      .eq("role", "student")
      .order("full_name");

    if (errWithout) {
      const { data: minimal, error: errMinimal } = await supabase
        .from("profiles")
        .select("id, full_name, email")
        .eq("role", "student")
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
        teacher_id: null,
      }));
    } else {
      data = (withoutStatus ?? []).map((row) => ({
        ...row,
        grade: (row as { grade?: string | null }).grade ?? null,
        enrollment_status: (row as { enrollment_status?: string }).enrollment_status ?? "enrolled",
        teacher_id: (row as { teacher_id?: string | null }).teacher_id ?? null,
      }));
    }
  } else {
    data = (withStatus ?? []).map((row) => ({
      ...row,
      teacher_id: (row as { teacher_id?: string | null }).teacher_id ?? null,
    }));
  }

  return NextResponse.json(data ?? []);
}

export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "서버 설정이 없습니다. SUPABASE_SERVICE_ROLE_KEY를 설정해 주세요." },
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

  // 트리거가 이미 프로필을 만들었을 수 있음 → 있으면 update, 없으면 insert
  const profileRow = {
    id: userData.user.id,
    role: "student" as const,
    full_name: fullName,
    email,
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
      })
      .eq("id", userData.user.id);
    if (updateError) {
      return NextResponse.json(
        { error: `프로필 저장에 실패했습니다. ${updateError.message}`.trim() },
        { status: 500 }
      );
    }
  } else {
    const { error: insertError } = await supabase
      .from("profiles")
      .insert(profileRow);
    if (insertError) {
      const msg = insertError.message ?? "";
      const hint = msg.includes("enrollment_status")
        ? " Supabase에서 migration_enrollment_status.sql을 실행해 주세요."
        : "";
      return NextResponse.json(
        { error: `프로필 저장에 실패했습니다.${hint} ${msg}`.trim() },
        { status: 500 }
      );
    }
  }

  // enrollment_status 컬럼이 있으면 재원생으로 설정 (마이그레이션 적용된 경우)
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

/** 퇴원/재원 처리: enrollment_status만 변경 (계정 삭제 안 함) */
export async function PATCH(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "서버 설정이 없습니다. SUPABASE_SERVICE_ROLE_KEY를 설정해 주세요." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  // 한 명만 대상: user_id는 반드시 문자열 하나 (배열·객체 등이 오면 거부)
  const rawUserId = body.user_id;
  const userId =
    typeof rawUserId === "string" ? rawUserId.trim() : "";

  if (!userId || Array.isArray(rawUserId)) {
    return NextResponse.json({ error: "대상 학생을 한 명만 지정해 주세요." }, { status: 400 });
  }

  const enrollmentStatus = body.enrollment_status;
  const status =
    enrollmentStatus === "withdrawn" ? "withdrawn" : "enrolled";

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "해당 사용자를 찾을 수 없습니다." }, { status: 404 });
  }
  if (profile.role === "admin") {
    return NextResponse.json({ error: "관리자 계정은 변경할 수 없습니다." }, { status: 400 });
  }

  const { data: updatedRows, error: updateError } = await supabase
    .from("profiles")
    .update({ enrollment_status: status })
    .eq("id", userId)
    .select("id");

  if (updateError) {
    return NextResponse.json(
      { error: updateError.message.includes("enrollment_status") ? "enrollment_status 컬럼이 없습니다. Supabase에서 migration_enrollment_status.sql을 실행해 주세요." : updateError.message },
      { status: 500 }
    );
  }
  if (!updatedRows || updatedRows.length !== 1) {
    return NextResponse.json(
      { error: "퇴원/재원 처리 대상이 한 명이 아니어서 중단했습니다. 다시 시도해 주세요." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, enrollment_status: status });
}

export async function DELETE(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "서버 설정이 없습니다. SUPABASE_SERVICE_ROLE_KEY를 설정해 주세요." },
      { status: 500 }
    );
  }

  const body = await req.json().catch(() => ({}));
  // 한 명만 삭제: user_id는 반드시 문자열 하나 (배열 등이 오면 거부)
  const rawUserId = body.user_id;
  const userId = typeof rawUserId === "string" ? rawUserId.trim() : "";

  if (!userId || Array.isArray(rawUserId)) {
    return NextResponse.json({ error: "삭제할 학생을 한 명만 지정해 주세요." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile } = await supabase
    .from("profiles")
    .select("id, role")
    .eq("id", userId)
    .single();

  if (!profile) {
    return NextResponse.json({ error: "해당 사용자를 찾을 수 없습니다." }, { status: 404 });
  }
  if (profile.role === "admin") {
    return NextResponse.json({ error: "관리자 계정은 삭제할 수 없습니다." }, { status: 400 });
  }

  await supabase.from("assignments").delete().eq("user_id", userId);
  const { data: deletedProfiles, error: deleteProfileError } = await supabase
    .from("profiles")
    .delete()
    .eq("id", userId)
    .select("id");

  if (deleteProfileError) {
    return NextResponse.json({ error: deleteProfileError.message }, { status: 500 });
  }
  if (!deletedProfiles || deletedProfiles.length !== 1) {
    return NextResponse.json(
      { error: "삭제 대상이 한 명이 아니어서 중단했습니다. 다시 시도해 주세요." },
      { status: 500 }
    );
  }

  const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(userId);

  if (deleteAuthError) {
    return NextResponse.json(
      { error: "계정 삭제 중 오류가 발생했습니다. " + deleteAuthError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

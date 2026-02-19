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

/** 강사: 본인 이메일 등록/수정 (비밀번호 찾기용) */
export async function PATCH(req: Request) {
  const teacher = await requireTeacher(req);
  if (!teacher) {
    return NextResponse.json({ error: "강사만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const emailInput = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!emailInput || !emailInput.includes("@")) {
    return NextResponse.json({ error: "올바른 이메일을 입력해 주세요." }, { status: 400 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { error: updateAuthError } = await admin.auth.admin.updateUserById(teacher.id, {
    email: emailInput,
    email_confirm: true,
  });
  if (updateAuthError) {
    if (
      updateAuthError.message?.toLowerCase().includes("already") ||
      updateAuthError.message?.toLowerCase().includes("duplicate")
    ) {
      return NextResponse.json({ error: "이미 다른 계정에서 사용 중인 이메일입니다." }, { status: 400 });
    }
    return NextResponse.json(
      { error: updateAuthError.message || "이메일 변경에 실패했습니다." },
      { status: 500 }
    );
  }

  const { error: updateProfileError } = await admin
    .from("profiles")
    .update({ email: emailInput })
    .eq("id", teacher.id);

  if (updateProfileError) {
    return NextResponse.json(
      { error: updateProfileError.message || "프로필 저장에 실패했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, email: emailInput });
}

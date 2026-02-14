import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * 로그인한 학생이 본인 이메일을 등록/수정합니다.
 * profiles.email과 auth.users.email을 함께 갱신하여, 이후 비밀번호 재설정 및 로그인(이름+이메일+비번)에 사용됩니다.
 */
export async function PATCH(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey || !serviceRoleKey) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const anon = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user } } = await anon.auth.getUser(token);
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile } = await admin
    .from("profiles")
    .select("id, role")
    .eq("id", user.id)
    .single();

  if (!profile || profile.role !== "student") {
    return NextResponse.json({ error: "학생만 이메일을 등록할 수 있습니다." }, { status: 403 });
  }

  const body = await req.json().catch(() => ({}));
  const emailInput = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!emailInput || !emailInput.includes("@")) {
    return NextResponse.json({ error: "올바른 이메일을 입력해 주세요." }, { status: 400 });
  }

  const { error: updateAuthError } = await admin.auth.admin.updateUserById(user.id, {
    email: emailInput,
    email_confirm: true,
  });
  if (updateAuthError) {
    if (updateAuthError.message?.toLowerCase().includes("already") || updateAuthError.message?.toLowerCase().includes("duplicate")) {
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
    .eq("id", user.id);

  if (updateProfileError) {
    return NextResponse.json(
      { error: updateProfileError.message || "프로필 저장에 실패했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true, email: emailInput });
}

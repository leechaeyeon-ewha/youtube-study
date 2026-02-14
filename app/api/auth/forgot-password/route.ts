import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * 학생 비밀번호 재설정 링크 발급: 이름으로 이메일 조회 후 recovery 링크 생성.
 * Supabase 대시보드 → Authentication → URL Configuration 에서
 * Redirect URLs에 https://도메인/reset-password, http://localhost:3000/reset-password 를 추가해야 합니다.
 */
export async function POST(req: Request) {
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  if (!fullName) {
    return NextResponse.json({ error: "이름을 입력해 주세요." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("email")
    .eq("role", "student")
    .ilike("full_name", fullName)
    .limit(1)
    .maybeSingle();

  if (profileError || !profile?.email) {
    return NextResponse.json(
      { error: "등록된 학생이 없거나 이름이 일치하지 않습니다." },
      { status: 404 }
    );
  }

  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL ||
    (req.headers.get("x-forwarded-proto") && req.headers.get("x-forwarded-host")
      ? `${req.headers.get("x-forwarded-proto")}://${req.headers.get("x-forwarded-host")}`
      : null) ||
    "http://localhost:3000";
  const redirectTo = `${baseUrl.replace(/\/$/, "")}/reset-password`;

  const { data: linkData, error: linkError } = await supabase.auth.admin.generateLink({
    type: "recovery",
    email: profile.email,
    options: { redirectTo },
  });

  if (linkError) {
    return NextResponse.json(
      { error: linkError.message || "재설정 링크 생성에 실패했습니다." },
      { status: 500 }
    );
  }

  const actionLink = linkData?.action_link;
  if (!actionLink) {
    return NextResponse.json(
      { error: "재설정 링크를 가져올 수 없습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({ redirect_url: actionLink });
}

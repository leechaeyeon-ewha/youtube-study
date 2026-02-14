import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * 학생 비밀번호 재설정 링크 발급: 이름으로 이메일 조회 후 recovery 링크 생성.
 * Supabase 대시보드 → Authentication → URL Configuration 에서
 * Redirect URLs에 https://도메인/reset-password, http://localhost:3000/reset-password 를 추가해야 합니다.
 * 배포 시 Vercel 등에 NEXT_PUBLIC_APP_URL=https://실제도메인 을 설정하면 리다이렉트가 안정적으로 동작합니다.
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

  // 재설정 후 리다이렉트할 앱 주소. 배포 시 NEXT_PUBLIC_APP_URL 설정 권장.
  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  let originOrigin: string | null = null;
  if (origin) {
    try {
      originOrigin = new URL(origin).origin;
    } catch {
      // ignore invalid origin
    }
  }
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    (forwardedProto && forwardedHost ? `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "") : null) ||
    originOrigin ||
    (host ? `${forwardedProto === "https" ? "https" : "http"}://${host}`.replace(/\/$/, "") : null) ||
    "http://localhost:3000";
  const redirectTo = `${baseUrl}/reset-password`;

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

  const properties = linkData && "properties" in linkData ? linkData.properties : undefined;
  const actionLink = properties && "action_link" in properties ? properties.action_link : undefined;
  if (!actionLink || typeof actionLink !== "string") {
    return NextResponse.json(
      { error: "재설정 링크를 가져올 수 없습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({ redirect_url: actionLink });
}

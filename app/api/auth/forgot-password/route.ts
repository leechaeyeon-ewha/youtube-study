import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;

/**
 * 학생 비밀번호 재설정: 이름+이메일이 등록 정보와 일치할 때만,
 * 해당 이메일로 재설정 링크를 보냅니다. 링크는 클라이언트에 반환하지 않아
 * 본인(이메일 소유자)만 비밀번호를 변경할 수 있습니다.
 * Supabase Redirect URLs에 https://도메인/reset-password, http://localhost:3000/reset-password 추가 필요.
 */
export async function POST(req: Request) {
  if (!supabaseUrl || !serviceRoleKey || !anonKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }

  const body = await req.json().catch(() => ({}));
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";
  const emailInput = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!fullName) {
    return NextResponse.json({ error: "이름을 입력해 주세요." }, { status: 400 });
  }
  if (!emailInput) {
    return NextResponse.json({ error: "이메일을 입력해 주세요." }, { status: 400 });
  }

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error: profileError } = await supabaseAdmin
    .from("profiles")
    .select("email")
    .eq("role", "student")
    .ilike("full_name", fullName)
    .limit(1)
    .maybeSingle();

  if (profileError || !profile?.email) {
    return NextResponse.json(
      { error: "이름과 이메일이 등록된 정보와 일치하지 않습니다." },
      { status: 400 }
    );
  }

  const profileEmailLower = (profile.email || "").toLowerCase();
  if (profileEmailLower !== emailInput) {
    return NextResponse.json(
      { error: "이름과 이메일이 등록된 정보와 일치하지 않습니다." },
      { status: 400 }
    );
  }

  const forwardedProto = req.headers.get("x-forwarded-proto");
  const forwardedHost = req.headers.get("x-forwarded-host");
  const origin = req.headers.get("origin");
  const host = req.headers.get("host");
  let originOrigin: string | null = null;
  if (origin) {
    try {
      originOrigin = new URL(origin).origin;
    } catch {
      // ignore
    }
  }
  const baseUrl =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/$/, "") ||
    (forwardedProto && forwardedHost ? `${forwardedProto}://${forwardedHost}`.replace(/\/$/, "") : null) ||
    originOrigin ||
    (host ? `${forwardedProto === "https" ? "https" : "http"}://${host}`.replace(/\/$/, "") : null) ||
    "http://localhost:3000";
  const redirectTo = `${baseUrl}/reset-password`;

  const supabaseAnon = createClient(supabaseUrl, anonKey);
  const { error: resetError } = await supabaseAnon.auth.resetPasswordForEmail(profile.email, {
    redirectTo,
  });

  if (resetError) {
    return NextResponse.json(
      { error: resetError.message || "재설정 메일 발송에 실패했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "등록된 이메일로 재설정 링크를 보냈습니다. 이메일을 확인해 주세요.",
  });
}

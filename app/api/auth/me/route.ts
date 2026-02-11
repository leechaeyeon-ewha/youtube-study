import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!;

/**
 * 로그인한 사용자의 프로필(role 등)을 서버에서 조회해 반환.
 * 루트/관리자 레이아웃의 리다이렉트 판단에 사용 (클라이언트 RLS 이슈 회피).
 */
export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  const token = authHeader?.replace(/^Bearer\s+/i, "");
  if (!token || !supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  const anon = createClient(supabaseUrl, supabaseAnonKey);
  const { data: { user } } = await anon.auth.getUser(token);
  if (!user) {
    return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });
  }

  if (!serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }

  const admin = createClient(supabaseUrl, serviceRoleKey);
  const { data: profile, error } = await admin
    .from("profiles")
    .select("id, role, full_name, email")
    .eq("id", user.id)
    .single();

  if (error || !profile) {
    return NextResponse.json({ error: "프로필을 찾을 수 없습니다." }, { status: 404 });
  }

  return NextResponse.json({
    id: profile.id,
    role: profile.role,
    full_name: profile.full_name,
    email: profile.email,
  });
}

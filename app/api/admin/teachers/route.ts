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

/** 관리자 전용: 강사 목록 조회 */
export async function GET(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "teacher")
    .order("full_name");

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

/** 관리자 전용: 강사 등록 (초기 비밀번호, 강사 이름). 이메일은 내부용으로 자동 생성 */
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

  let body: { password?: string; full_name?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }
  const password = typeof body.password === "string" ? body.password : "";
  const fullName = typeof body.full_name === "string" ? body.full_name.trim() : "";

  if (!password || password.length < 4) {
    return NextResponse.json({ error: "비밀번호는 4자 이상 입력해 주세요." }, { status: 400 });
  }
  if (!fullName) {
    return NextResponse.json({ error: "강사 이름을 입력해 주세요." }, { status: 400 });
  }

  // 강사용 계정은 외부 노출용 이메일이 필요 없으므로 내부용 랜덤 이메일 생성
  const email = `teacher_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@academy.local`;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: userData, error: createError } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: fullName, role: "teacher" },
  });

  if (createError) {
    if (createError.message?.toLowerCase().includes("already")) {
      return NextResponse.json({ error: "이미 사용 중인 아이디입니다." }, { status: 400 });
    }
    return NextResponse.json({ error: createError.message }, { status: 400 });
  }

  if (!userData.user) {
    return NextResponse.json({ error: "사용자 생성에 실패했습니다." }, { status: 500 });
  }

  const { data: existing } = await supabase
    .from("profiles")
    .select("id")
    .eq("id", userData.user.id)
    .maybeSingle();

  const profileRow = {
    id: userData.user.id,
    role: "teacher" as const,
    full_name: fullName,
    email,
  };

  if (existing) {
    const { error: updateError } = await supabase
      .from("profiles")
      .update({ role: "teacher", full_name: fullName, email })
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
      return NextResponse.json(
        { error: `프로필 저장에 실패했습니다. ${insertError.message}`.trim() },
        { status: 500 }
      );
    }
  }

  return NextResponse.json({
    id: userData.user.id,
    full_name: fullName,
    email,
  });
}

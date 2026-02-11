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

  const body = await req.json();
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

  // 트리거가 없거나 실패해도 목록에 나오도록 upsert (role 반드시 'student')
  const { error: upsertError } = await supabase
    .from("profiles")
    .upsert(
      {
        id: userData.user.id,
        role: "student",
        full_name: fullName,
        email,
      },
      { onConflict: "id" }
    );

  if (upsertError) {
    return NextResponse.json(
      { error: "프로필 저장에 실패했습니다." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    id: userData.user.id,
    full_name: fullName,
    email,
  });
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
  const userId = typeof body.user_id === "string" ? body.user_id.trim() : "";

  if (!userId) {
    return NextResponse.json({ error: "삭제할 학생을 지정해 주세요." }, { status: 400 });
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
  await supabase.from("profiles").delete().eq("id", userId);

  const { error: deleteAuthError } = await supabase.auth.admin.deleteUser(userId);

  if (deleteAuthError) {
    return NextResponse.json(
      { error: "계정 삭제 중 오류가 발생했습니다. " + deleteAuthError.message },
      { status: 500 }
    );
  }

  return NextResponse.json({ success: true });
}

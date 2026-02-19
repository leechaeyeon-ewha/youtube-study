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

/** 관리자 전용: 선택한 학생들의 담당 강사(teacher_id) 설정 */
export async function POST(req: Request) {
  const admin = await requireAdmin(req);
  if (!admin) {
    return NextResponse.json({ error: "관리자만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }

  let body: { teacherId?: string | null; studentIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "요청 본문을 읽을 수 없습니다." }, { status: 400 });
  }
  const teacherId = body.teacherId === null || body.teacherId === "" ? null : (body.teacherId as string | undefined);
  const studentIds = Array.isArray(body.studentIds) ? body.studentIds.filter((id): id is string => typeof id === "string") : [];

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  if (teacherId != null) {
    const { data: teacher } = await supabase.from("profiles").select("id, role").eq("id", teacherId).single();
    if (!teacher || teacher.role !== "teacher") {
      return NextResponse.json({ error: "유효한 강사가 아닙니다." }, { status: 400 });
    }
  }

  if (studentIds.length === 0) {
    return NextResponse.json({ updated: 0 });
  }

  const { error } = await supabase
    .from("profiles")
    .update({ teacher_id: teacherId })
    .eq("role", "student")
    .in("id", studentIds);

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("teacher_id")) {
      return NextResponse.json(
        { error: "teacher_id 컬럼이 없습니다. Supabase에서 supabase/migration_teacher_role.sql을 실행해 주세요." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ updated: studentIds.length });
}

import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { ASSIGNMENT_SELECT_ADMIN } from "@/lib/assignments";

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

/** 강사 전용: 본인 담당 학생들의 배정 목록만 조회 */
export async function GET(req: Request) {
  const teacher = await requireTeacher(req);
  if (!teacher) {
    return NextResponse.json({ error: "강사만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      { error: "서버 설정이 없습니다." },
      { status: 500 }
    );
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: studentRows } = await supabase
    .from("profiles")
    .select("id")
    .eq("role", "student")
    .eq("teacher_id", teacher.id);

  const studentIds = (studentRows ?? []).map((r) => (r as { id: string }).id);
  if (studentIds.length === 0) {
    return NextResponse.json([]);
  }

  const { data, error } = await supabase
    .from("assignments")
    .select(ASSIGNMENT_SELECT_ADMIN)
    .in("user_id", studentIds)
    .order("created_at", { ascending: false });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json(data ?? []);
}

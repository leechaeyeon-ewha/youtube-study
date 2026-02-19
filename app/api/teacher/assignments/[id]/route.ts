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

async function assertAssignmentBelongsToTeacher(
  supabase: ReturnType<typeof createClient>,
  assignmentId: string,
  teacherId: string
): Promise<boolean> {
  const { data: row } = await supabase
    .from("assignments")
    .select("user_id")
    .eq("id", assignmentId)
    .single();
  if (!row) return false;
  const userId = (row as { user_id: string }).user_id;
  const { data: student } = await supabase
    .from("profiles")
    .select("teacher_id")
    .eq("id", userId)
    .eq("role", "student")
    .single();
  return (student as { teacher_id?: string | null })?.teacher_id === teacherId;
}

/** 강사: 본인 담당 학생의 배정만 수정 (우선 학습, 스킵 방지) */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher(req);
  if (!teacher) {
    return NextResponse.json({ error: "강사만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }
  const { id: assignmentId } = await params;
  if (!assignmentId) {
    return NextResponse.json({ error: "배정 ID가 필요합니다." }, { status: 400 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const allowed = await assertAssignmentBelongsToTeacher(supabase, assignmentId, teacher.id);
  if (!allowed) {
    return NextResponse.json({ error: "해당 배정을 수정할 권한이 없습니다." }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const updates: Record<string, unknown> = {};
  if (Object.prototype.hasOwnProperty.call(body, "is_priority")) updates.is_priority = !!body.is_priority;
  if (Object.prototype.hasOwnProperty.call(body, "prevent_skip")) updates.prevent_skip = !!body.prevent_skip;
  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "수정할 필드를 지정해 주세요." }, { status: 400 });
  }
  const { error } = await supabase.from("assignments").update(updates).eq("id", assignmentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

/** 강사: 본인 담당 학생의 배정만 해제 */
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const teacher = await requireTeacher(req);
  if (!teacher) {
    return NextResponse.json({ error: "강사만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }
  const { id: assignmentId } = await params;
  if (!assignmentId) {
    return NextResponse.json({ error: "배정 ID가 필요합니다." }, { status: 400 });
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey);
  const allowed = await assertAssignmentBelongsToTeacher(supabase, assignmentId, teacher.id);
  if (!allowed) {
    return NextResponse.json({ error: "해당 배정을 해제할 권한이 없습니다." }, { status: 403 });
  }
  const { error } = await supabase.from("assignments").delete().eq("id", assignmentId);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ success: true });
}

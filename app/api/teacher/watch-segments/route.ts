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

/** 인접/겹치는 구간을 하나로 합침 */
function mergeSegments(segments: { start_sec: number; end_sec: number }[]) {
  if (segments.length === 0) return [];
  if (segments.length === 1) return [...segments];
  const sorted = [...segments].sort((a, b) => a.start_sec - b.start_sec);
  const merged: { start_sec: number; end_sec: number }[] = [];
  let cur = { ...sorted[0] };
  for (let i = 1; i < sorted.length; i++) {
    const s = sorted[i];
    if (s.start_sec <= cur.end_sec + 1) {
      cur.end_sec = Math.max(cur.end_sec, s.end_sec);
    } else {
      merged.push(cur);
      cur = { ...s };
    }
  }
  merged.push(cur);
  return merged;
}

/** 강사: 담당 학생의 배정에 대한 시청 구간 목록 조회 (몇 분~몇 분). 스킵 허용 배정용 */
export async function GET(req: Request) {
  const teacher = await requireTeacher(req);
  if (!teacher) {
    return NextResponse.json({ error: "강사만 접근할 수 있습니다." }, { status: 401 });
  }
  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json({ error: "서버 설정이 없습니다." }, { status: 500 });
  }

  const { searchParams } = new URL(req.url);
  const assignmentId = searchParams.get("assignmentId");
  if (!assignmentId) {
    return NextResponse.json({ error: "assignmentId가 필요합니다." }, { status: 400 });
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey);

  const { data: assignment } = await supabase
    .from("assignments")
    .select("id, user_id")
    .eq("id", assignmentId)
    .single();

  if (!assignment) {
    return NextResponse.json({ error: "배정을 찾을 수 없습니다." }, { status: 404 });
  }

  const { data: student } = await supabase
    .from("profiles")
    .select("id, teacher_id")
    .eq("id", (assignment as { user_id: string }).user_id)
    .eq("role", "student")
    .single();

  if (!student || (student as { teacher_id?: string | null }).teacher_id !== teacher.id) {
    return NextResponse.json({ error: "해당 배정에 대한 권한이 없습니다." }, { status: 403 });
  }

  const { data, error } = await supabase
    .from("watch_segments")
    .select("start_sec, end_sec")
    .eq("assignment_id", assignmentId)
    .order("start_sec", { ascending: true });

  if (error) {
    const msg = error.message ?? "";
    if (msg.includes("could not find the table") || msg.includes("watch_segments") || msg.includes("does not exist")) {
      return NextResponse.json([]);
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const raw = (data ?? []).map((r) => ({ start_sec: Number(r.start_sec), end_sec: Number(r.end_sec) }));
  const merged = mergeSegments(raw);
  return NextResponse.json(merged);
}
